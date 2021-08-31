// SPDX-License-Identifier: MIT
pragma solidity >=0.6.8 <0.7.0;

interface IInfoOracle {
	function bipsToTreasury() external view returns(uint16);
	function MinimumOrderbookFee() external view returns(uint8);
	function TreasuryFeeIsCollected() external view returns(bool);
	function sendTo() external view returns(address);
	function WrapperToYTSlippageConst(address _wrapperAddr) external view returns(uint);
	function WrapperToZCBFeeConst(address _wrapperAddr) external view returns(uint);
	function WrapperToYTFeeConst(address _wrapperAddr) external view returns(uint);
	function YTammSlippageConstants(address _FCPaddress) external view returns(uint);
	function ZCBammFeeConstants(address _FCPaddress) external view returns(uint);
	function YTammFeeConstants(address _FCPaddress) external view returns(uint);
	function treasuryFee(uint larger, uint smaller) external view returns (uint toTreasury, address _sendTo);
	function WrapperOrderbookFeeBips(address _wrapperAddr) external view returns(uint8);
	function FCPOrderbookFeeBips(address _fixCapitalPoolAddress) external view returns(uint8);
	function getOrderbookFeeBips(address _fixCapitalPoolAddress) external view returns(uint8);
	function getZCBammFeeConstant(address _fixCapitalPoolAddress) external view returns (uint FeeConstant);
	function getYTammFeeConstant(address _fixCapitalPoolAddress) external view returns (uint FeeConstant);
	function getSlippageConstant(address _fixCapitalPoolAddress) external view returns (uint SlippageConstant);
	function DelegatedControllers(address _owner) external view returns (address delegate);
	//for use by DBSFVaultFactory
	function StabilityFeeAPR(address _vaultFactoryAddress, address _wrapperAddress) external view returns (uint64 stabilityFeeAPR);
	function collateralWhitelist(address _vaultFactoryAddress, address _assetAddress) external view returns (address underlyingAsset);
	function FCPtoWrapper(address _vaultFactoryAddress, address _FCPaddress) external view returns (address wrapperAddress);

	//---------management--------------

	function setDelegatedController(address _manager) external;
	function wrapperSetAmmFeeConstants(address _wrapper, uint _ZCBammFeeConstant, uint _YTammFeeConstant) external;
	function wrapperSetOrderbookFeeConstant(address _wrapper, uint8 _orderbookFeeBips) external;
	function wrapperSetSlippageConst(address _wrapper, uint _SlippageConstant) external;
	function setAmmFeeConstants(address _fixCapitalPoolAddress, uint _ZCBammFeeConstant, uint _YTammFeeConstant) external;
	function setOrderbookFeeConstant(address _fixCapitalPoolAddress, uint8 _orderbookFeeBips) external;
	function setSlippageConstant(address _fixCapitalPoolAddress, uint256 _SlippageConstant) external;
	//for use by DBSFVaultFactory admins
	function setStabilityFeeAPR(address _vaultFactoryAddress, address _wrapperAddress, uint64 _stabilityFeeAPR) external;
	function whitelistWrapper(address _vaultFactoryAddress, address _wrapperAddress) external;
	function whitelistAsset(address _vaultFactoryAddress, address _assetAddress) external;
	function whitelistFixCapitalPool(address _vaultFactoryAddress, address _FCPaddress) external;

	//---------InfoOracle-Admin--------

	function setMinimumOrderbookFee(uint8 _orderbookFeeBips) external;
	function setToTreasuryFee(uint16 _bipsToTreasury) external;
	function setSendTo(address _sendTo) external;
	function setTreasuryFeeIsCollected(bool _TreasuryFeeIsCollected) external;

}