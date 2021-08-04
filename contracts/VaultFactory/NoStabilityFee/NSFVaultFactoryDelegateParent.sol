// SPDX-License-Identifier: MIT
pragma experimental ABIEncoderV2;
pragma solidity >=0.6.8 <0.7.0;

import "../../libraries/SafeMath.sol";
import "../../libraries/SignedSafeMath.sol";
import "../../interfaces/IVaultManagerFlashReceiver.sol";
import "../../interfaces/IFixCapitalPool.sol";
import "../../interfaces/IZeroCouponBond.sol";
import "../../interfaces/IVaultHealth.sol";
import "../../interfaces/IWrapper.sol";
import "../../interfaces/IERC20.sol";
import "../../helpers/Ownable.sol";
import "./NSFVaultFactoryData.sol";

contract NSFVaultFactoryDelegateParent is NSFVaultFactoryData {
	using SafeMath for uint;
	using SignedSafeMath for int;

	/*
		YTVaults must have at least MIN_YIELD_SUPPLIED yield supplied
		This ensures that there are no problems liquidating vaults

		if a user wishes to have no yield supplied to a vault said user
		should use a normal vault and not use a YTvault
	*/
	uint internal constant MIN_YIELD_SUPPLIED = 1e6;

	/*
		@Description: ensure that short interst rasing by a specific amount does not push an asset over the debt ceiling

		@param address _fixCapitalPoolAddress: address of the ZCB for which to raise short interst
		@param uint _amount: amount ny which to raise short interst
	*/
	function raiseShortInterest(address _fixCapitalPoolAddress, uint _amount) internal {
		address underlyingAssetAddress = IFixCapitalPool(_fixCapitalPoolAddress).underlyingAssetAddress();
		uint temp = _shortInterestAllDurations[underlyingAssetAddress].add(_amount);
		require(vaultHealthContract.maximumShortInterest(underlyingAssetAddress) >= temp);
		_shortInterestAllDurations[underlyingAssetAddress] = temp;
	}

	/*
		@Description: decrease short interest

		@param address _fixCapitalPoolAddress: address of the ZCB for which to decrease short interest
		@param uint _amount: the amount by which to decrease short interest
	*/
	function lowerShortInterest(address _fixCapitalPoolAddress, uint _amount) internal {
		address underlyingAssetAddress = IFixCapitalPool(_fixCapitalPoolAddress).underlyingAssetAddress();
		_shortInterestAllDurations[underlyingAssetAddress] = _shortInterestAllDurations[underlyingAssetAddress].sub(_amount);
	}
	
	/*
		@Description: distribute surplus appropriately between vault owner and contract owner
			this function is called by other liquidation management functions

		@param address _vaultOwner: the owner of the vault that has between liquidated
		@param address _asset: the address of the asset for which surplus has been acquired
		@param uint _amount: the amount of surplus
	*/
	function distributeSurplus(address _vaultOwner, address _asset, uint _amount) internal {
		uint retainedSurplus = _amount * _liquidationRebateBips / TOTAL_BASIS_POINTS;
		_liquidationRebates[_vaultOwner][_asset] += retainedSurplus;
		_revenue[_asset] += _amount-retainedSurplus;
	}

	/*
		@Description: when a bidder is outbid return their bid

		@param address _bidder: the address of the bidder
		@param address _asset: the address of the FCP corresponding to the ZCB that the bidder
			posted with their bid in
		@param uint _amount: the amount of _asset that was posted by the bidder
	*/
	function refundBid(address _bidder, address _FCPaddr, uint _amount) internal {
		IFixCapitalPool(_FCPaddr).mintZCBTo(_bidder, _amount);
	}

	/*
		@Description: when a bidder makes a bid collect collateral for their bid

		@param address _bidder: the address of the bidder
		@param address _asset: the address of the FCP corresponding to the ZCB that the bidder
			posted with their bid in
		@param uint _amount: the amount of _asset that the bidder is required to post
	*/
	function collectBid(address _bidder, address _FCPaddr, uint _amount) internal {
		IFixCapitalPool(_FCPaddr).burnZCBFrom(_bidder, _amount);
	}

	/*
		@Description: ensure that we pass the address of the underlying asset of wrapper assets to
			the vault health contract rather than the address of the wrapper asset
			also ensure that we adjust the amount from the wrapped amount to the non wrapped amount
			if necessary

		@param address _suppliedAsset: the address of the asset that is supplied as collateral
		@param uint _suppliedAmount: the amount of the supplied asset that is being used as collateral

		@return address addr: the address for assetSupplied to pass to the vault health contract
		@return uint amt: the amount for amountSupplied to pass to the vault health contract
	*/
	function passInfoToVaultManager(address _suppliedAsset, uint _suppliedAmount) internal view returns (address addr, uint amt) {
		addr = _wrapperToUnderlyingAsset[_suppliedAsset];
		if (addr == address(0) || addr == address(1)) {
			addr = _suppliedAsset;
			amt = _suppliedAmount;
		}
		else {
			amt = IWrapper(_suppliedAsset).WrappedAmtToUnitAmt_RoundDown(_suppliedAmount);
		}
	}


	/*
		@Description: ensure that a vault will not be sent into the liquidation zone if the cross asset price
			and the borrow and supplied asset rates change a specific amount

		@param address _assetSupplied: the asset used as collateral
			this asset may be a ZCB or any other asset that is whitelisted
		@param address _assetBorrowed: the ZCB that is borrowed from the new vault
`		@param uint _amountSupplied: the amount of _assetSupplied posed as collateral
		@param uint _amountBorrowed: the amount of _assetBorrowed borrowed
		@param uint _priceMultiplier: a multiplier > 1
			we ensure the vault will not be sent into the liquidation zone if the cross asset price
			of _assetBorrowed to _assetSupplied increases by a factor of _priceMultiplier
			(in terms of basis points)
		@param int128 _suppliedRateChange: a multiplier > 1
			we ensure the vault will not be sent into the liquidation zone if the rate on the supplied
			asset increases by a factor of _suppliedRateChange
			(in ABDK format)
		@param int128 _borrowRateChange: a multiplier < 1
			we ensure the vault will not be sent into the liquidation zone if the rate on the borrow
			asset decreases by a factor of _borrowRateChange
			(in ABDK format)

		@return bool: true if vault is not sent into liquidation zone from changes,
			false otherwise
	*/
	function vaultWithstandsChange(
		address _assetSupplied,
		address _assetBorrowed,
		uint _amountSupplied,
		uint _amountBorrowed,
		uint _priceMultiplier,
		int128 _suppliedRateChange,
		int128 _borrowRateChange
	) internal view returns (bool) {

		require(_priceMultiplier >= TOTAL_BASIS_POINTS);
		require(_suppliedRateChange >= ABDK_1);
		require(_borrowRateChange <= ABDK_1);

		(address _suppliedAddrToPass, uint _suppliedAmtToPass) = passInfoToVaultManager(_assetSupplied, _amountSupplied);

		return vaultHealthContract.vaultWithstandsChange(
			false,
			_suppliedAddrToPass,
			_assetBorrowed,
			_suppliedAmtToPass,
			_amountBorrowed,
			_priceMultiplier,
			_suppliedRateChange,
			_borrowRateChange
		);
	}

	/*
		@Description: check if a vault is above the upper or lower collateralization limit

		@param address _assetSupplied: the asset used as collateral
			this asset may be a ZCB or any other asset that is whitelisted
		@param address _assetBorrowed: the ZCB that is borrowed from the new vault
`		@param uint _amountSupplied: the amount of _assetSupplied posed as collateral
		@param uint _amountBorrowed: the amount of _assetBorrowed borrowed
		@param bool _upper: true if we are to check the upper collateralization limit,
			false otherwise

		@return bool: true if vault satisfies the limit,
			false otherwise
	*/
	function satisfiesLimit(
		address _assetSupplied,
		address _assetBorrowed,
		uint _amountSupplied,
		uint _amountBorrowed,
		bool _upper
	) internal view returns (bool) {

		(address _suppliedAddrToPass, uint _suppliedAmtToPass) = passInfoToVaultManager(_assetSupplied, _amountSupplied);

		return ( _upper ?
			vaultHealthContract.satisfiesUpperLimit(_suppliedAddrToPass, _assetBorrowed, _suppliedAmtToPass, _amountBorrowed)
				:
			vaultHealthContract.satisfiesLowerLimit(_suppliedAddrToPass, _assetBorrowed, _suppliedAmtToPass, _amountBorrowed)
		);
	}

	/*
		@Description: distribute surplus appropriately between vault owner and contract owner
			this function is called by other liquidation management functions

		@param address _vaultOwner: the owner of the vault that has between liquidated
		@param address _FCPaddr: the address of the fix capital pool for which to distribte surplus
		@param uint _yieldAmount: value to add to rebate.amountYield
		@param int _bondAmount: value to add to rebate.amountBond
	*/
	function distributeYTSurplus(address _vaultOwner, address _FCPaddr, uint _yieldAmount, int _bondAmount) internal {
		YTPosition storage rebate = _YTLiquidationRebates[_vaultOwner][_FCPaddr];
		YTPosition storage revenue = _YTRevenue[_FCPaddr];
		uint _rebateBips = _liquidationRebateBips;
		uint yieldRebate = _yieldAmount * _rebateBips / TOTAL_BASIS_POINTS;
		int bondRebate = _bondAmount * int(_rebateBips) / int(TOTAL_BASIS_POINTS);
		rebate.amountYield += yieldRebate;
		rebate.amountBond += bondRebate;
		revenue.amountYield += _yieldAmount - yieldRebate;
		revenue.amountBond += _bondAmount - bondRebate;
	}

	/*
		@Description: given a fix capital pool and a balance from the balanceYield mapping
			convert the value from wrapped amount to unit amount
	*/
	function getUnitValueYield(address _FCP, uint _amountYield) internal view returns (uint unitAmountYield) {
		address wrapperAddr = _fixCapitalPoolToWrapper[_FCP];
		require(wrapperAddr != address(0));
		unitAmountYield = IWrapper(wrapperAddr).WrappedAmtToUnitAmt_RoundDown(_amountYield);
	}

	/*
		@Description: given an amount of wrapped token and a FCP contract which is based on the same wrapper
			convert an amount of wrapped token into the current amount of ZCB that is a subasset of the wrapped token

		@param address _FCP: the address of the FCP contract for which to find the amount of ZCB
		@param uint _amountWrapped: the amount of wrapped token for which to find the amount of ZCB as a subasset
	*/
	function getZCBcontainedInWrappedAmt(address _FCP, uint _amountWrapped) internal view returns (uint amountZCB) {
		if (IFixCapitalPool(_FCP).inPayoutPhase()) {
			uint conversionRate = IFixCapitalPool(_FCP).maturityConversionRate();
			amountZCB = conversionRate.mul(_amountWrapped) / (1 ether);
		}
		else {
			amountZCB = getUnitValueYield(_FCP, _amountWrapped);
		}
	}

	/*
		@Description: ensure that args for YTvaultWithstandsChange() never increase vault health
			all multipliers should have either no change on vault health or decrease vault health
			we make this a function and not a modifier because we will not always have the
			necessary data ready before execution of the functions in which we want to use this

		@param uint _priceMultiplier: a multiplier > 1
			we ensure the vault will not be sent into the liquidation zone if the cross asset price
			of _assetBorrowed to _assetSupplied increases by a factor of _priceMultiplier
			(in terms of basis points)
		@param int128 _suppliedRateChange: a multiplier > 1 if _positiveBondSupplied otherwise < 1
			we ensure the vault will not be sent into the liquidation zone if the rate on the supplied
			asset increases by a factor of _suppliedRateChange
			(in ABDK format)
		@param int128 _borrowRateChange: a multiplier < 1
			we ensure the vault will not be sent into the liquidation zone if the rate on the borrow
			asset decreases by a factor of _borrowRateChange
			(in ABDK format)
		@param bool _positiveBondSupplied: (ZCB supplied to vault > YT supplied to vault)
	*/
	function validateYTvaultMultipliers(
		uint _priceMultiplier,
		int128 _suppliedRateChange,
		int128 _borrowRateChange,
		bool _positiveBondSupplied
	) internal pure {
		require(_priceMultiplier >= TOTAL_BASIS_POINTS);
		require(_borrowRateChange <= ABDK_1);
		require(
			(_suppliedRateChange == ABDK_1) ||
			(_positiveBondSupplied ? _suppliedRateChange > ABDK_1 : _suppliedRateChange < ABDK_1)
		);
	}

	/*
		@Description: if a YTVault has the same FCPborrowed and FCPsupplied pay back as much debt as possible
			with the zcb contained as collateral in the vault
			this can only be done where FCPborrowed == FCPsupplied because the ZCB that is collateral is the
			same ZCB as the debt, this will not be true for any other type of Vault or YTVault

		@param address _owner: the owner of the YTVault for which to pay back debt
		@param uint _index: the index of the YTVault swithin YTvaults[_owner]
		@param YTVault memory _vault: this parameter will be modified if debt is paid back
			when this function is finished executing all member variables of _vault will == the member variables of
			the storage vault which _vault is a copy of
	*/
	function autopayYTVault(address _owner, uint _index, YTVault memory _vault) internal {
		if (_vault.FCPborrowed == _vault.FCPsupplied) {
			uint unitValueYield = getZCBcontainedInWrappedAmt(_vault.FCPborrowed, _vault.yieldSupplied);
			uint difference = _vault.bondSupplied >= 0 ? unitValueYield.add(uint(_vault.bondSupplied)) : unitValueYield.sub(uint(-_vault.bondSupplied));
			difference = difference > _vault.amountBorrowed ? _vault.amountBorrowed : difference;
			if (difference > 0) {
				_vault.bondSupplied -= int(difference);
				_vault.amountBorrowed -= difference;
				_YTvaults[_owner][_index].bondSupplied = _vault.bondSupplied;
				_YTvaults[_owner][_index].amountBorrowed = _vault.amountBorrowed;
			}
		}
	}

}