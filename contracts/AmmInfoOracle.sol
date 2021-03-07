pragma solidity >=0.6.0;
import "./helpers/Ownable.sol";
import "./libraries/SafeMath.sol";
import "./libraries/SignedSafeMath.sol";
import "./libraries/ABDKMath64x64.sol";
import "./libraries/BigMath.sol";

contract AmmInfoOracle is Ownable {

	using ABDKMath64x64 for int128;
	using SignedSafeMath for int256;
	using SafeMath for uint256;

	// 1.0 in super basis points
	uint32 constant totalSuperBasisPoints = 1_000_000_000;

	uint16 constant totalBasisPoints = 10_000;

	uint private constant SecondsPerYear = 31556926;

	// 1.0 in 64.64 format
	int128 private constant ABDK_1 = 1<<64;

	// 0.03125 in 64.64 format
	int128 private constant MaxAnnualRate = 1<<59;

	// 0.125 in super basis points
	uint32 private constant MaxMaxFee = 125_000_000;

	// the treasury should receive no more than 40% of total fee revenue
	uint16 private constant MaxBipsToTreasury = 4_000;

	uint public maxFee;

	//pct fee paid on swap with 1 year to maturity
	int128 public annualRate;

	uint16 public bipsToTreasury;

	address public sendTo;

	uint256 public SlippageConstant;

	constructor(uint32 _maxFee, int128 _annualRate, uint16 _bipsToTreasury, uint _SlippageConstant, address _sendTo) public {
		setMaxFee(_maxFee);
		setAnnualRate(_annualRate);
		setToTreasuryFee(_bipsToTreasury);
		SlippageConstant = _SlippageConstant;
		sendTo = _sendTo;
	}

	function setToTreasuryFee(uint16 _bipsToTreasury) public onlyOwner {
		require(_bipsToTreasury <= MaxBipsToTreasury);
		bipsToTreasury = _bipsToTreasury;
	}

	function setSendTo(address _sendTo) external onlyOwner {
		sendTo = _sendTo;
	}

	function setMaxFee(uint32 _maxFee) public onlyOwner {
		require(_maxFee >= 0, "Max Fee must not be negative");
		require(_maxFee <= MaxMaxFee, "_maxFee parameter above upper limit");
		maxFee = _maxFee;
	}

	function setAnnualRate(int128 _annualRate) public onlyOwner {
		require(_annualRate >= 0, "annual rate must not be negative");
		require(_annualRate <= MaxAnnualRate, "_annualRate parameter above upper limit");
		annualRate = _annualRate;
	}

	function setSlippageConstant(uint256 _SlippageConstant) public onlyOwner {
		SlippageConstant = _SlippageConstant;
	}

	function YT_U_feeAdjustedAmtIn(int128 yearsRemaining, uint YT, uint U) external view returns (uint amountIn_postFee, uint toTreasury, address _sendTo) {
		/*
			U is being swapped for a specific amount of YT
			because U is being swapped for YT we must increase
			the effective APY of the swap thus increasing the
			effective price paid for YT
		*/

		int128 originalAPY = BigMath.YT_U_APY(yearsRemaining, YT, U);

		/*
			feeAdjAPY-1 = (APY-1)/(1-annualRate)
			feeAdjAPY = (APY-1)/(1-annualRate) + 1
		*/
		int128 feeAdjAPY = originalAPY.sub(BigMath.ABDK_1).div(BigMath.ABDK_1.sub(annualRate)).add(BigMath.ABDK_1);

		uint256 newPrice = BigMath.UtoYT_Price(yearsRemaining, feeAdjAPY);

		amountIn_postFee = newPrice.mul(YT) >> 64;

		/*
			Ensure Fee charged is <= maximum fee
		*/
		uint _maxFee = maxFee;
		if (amountIn_postFee.mul(totalSuperBasisPoints).div(U).sub(totalSuperBasisPoints) > _maxFee) {
			/*
				(amountIn_postFee * totalSuperBips / U) - totalSuperBips == maxFee
				(amountIn_postFee * totalSuperBips / U) == maxFee + totalSuperBips
				amountIn_postFee == U * (maxFee + totalSuperBips) / totalSuperBips
			*/
			amountIn_postFee = U.mul(uint(totalSuperBasisPoints).add(_maxFee)).div(totalSuperBasisPoints);
		}

		uint totalFee = amountIn_postFee.sub(U);

		toTreasury = totalFee * bipsToTreasury / totalBasisPoints;
		_sendTo = sendTo;
	}

	function YT_U_feeAdjustedAmtOut(int128 yearsRemaining, uint YT, uint U) external view returns (uint amountOut_postFee, uint toTreasury, address _sendTo) {
		/*
			a specific amount of YT is being swapped for U
			because YT is being swapped for U we must decrease
			the effective APY of the swap thus increasing the
			effective price paid for U
		*/

		int128 originalAPY = BigMath.YT_U_APY(yearsRemaining, YT, U);

		/*
			feeAdjAPY-1 = (APY-1)*(1-annualRate)
			feeAdjAPY = (APY-1)*(1-annualRate) + 1
		*/
		int128 feeAdjAPY = originalAPY.sub(BigMath.ABDK_1).mul(BigMath.ABDK_1.sub(annualRate)).add(BigMath.ABDK_1);

		uint256 newPrice = BigMath.UtoYT_Price(yearsRemaining, feeAdjAPY);

		amountOut_postFee = newPrice.mul(YT) >> 64;

		/*
			Ensure Fee charged is <= maximum fee
		*/
		uint _maxFee = maxFee;
		if (U.mul(totalSuperBasisPoints).div(amountOut_postFee).sub(totalSuperBasisPoints) > _maxFee) {
			/*
				(U * totalSuperBips / amountOut_postFee) - totalSuperBips == maxFee
				U * totalSuperBips / amountOut_postFee == maxFee + totalSuperBips
				U * totalSuperBips == (maxFee + totalSuperBips) * amountOut_postFee
				amountOut_postFee == U * totalSuperBips / (maxFee + totalSuperBips)
			*/
			amountOut_postFee = U.mul(totalSuperBasisPoints).div(_maxFee.add(totalSuperBasisPoints));
		}

		uint totalFee = U.sub(amountOut_postFee);

		toTreasury = totalFee * bipsToTreasury / totalBasisPoints;
		_sendTo = sendTo;
	}

	/*
		Returns the percentage fee to be charged by the AMM denominated in basis points
	*/
	function getFeePct(uint _maturity) internal view returns (uint32 feePct) {
		require(_maturity > block.timestamp);
		int128 _annualRate = annualRate;	//gas savings
		uint _maxFee = maxFee;	//gas savings
		if (_annualRate == 0 || _maxFee == 0) {
			return 0;
		}
		int128 yearsRemaining = int128(((_maturity - block.timestamp) << 64) / SecondsPerYear);
		/*
			(1-feePct) == (1 - annualRate)**yearsRemaining
			feePct == 1 - (1 - annualRate)**yearsRemaining

			innerTerm = 1 - annualRate;

			feePct == 1 - innerTerm**yearsRemaining
			feePct == 1 - 2**(log_2(innerTerm**yearsRemaining))
			feePct == 1 - 2**(yearsRemaining*log_2(innerTerm))
		*/
		//due to checks we have done earlier we do not need to use .sub here
		int128 innerTerm = ABDK_1 - _annualRate;
		//due to checks we have done earlier we do not need to use .sub here and to know that converting to uint is safe
		uint result = totalSuperBasisPoints * uint(ABDK_1 - innerTerm.log_2().mul(yearsRemaining).exp_2()) >> 64;
		return uint32(result > _maxFee ? _maxFee : result);
	}

	/*
		amountIn_preFee / (1 - getPctFee()) == amountIn_postFee
	*/
	function feeAdjustedAmountIn(uint _maturity, uint _amountIn_preFee) external view returns (uint amountIn_postFee, uint toTreasury, address _sendTo) {
		amountIn_postFee = totalSuperBasisPoints * _amountIn_preFee / (totalSuperBasisPoints - getFeePct(_maturity));
		uint totalFee = amountIn_postFee - _amountIn_preFee;
		toTreasury = totalFee * bipsToTreasury / totalBasisPoints;
		_sendTo = sendTo;
	}


	/*
		amountOut_preFee * (1 - getPctFee()) == amountOut_postFee
	*/
	function feeAdjustedAmountOut(uint _maturity, uint _amountOut_preFee) external view returns (uint amountOut_postFee, uint toTreasury, address _sendTo) {
		amountOut_postFee = _amountOut_preFee * (totalSuperBasisPoints - getFeePct(_maturity)) / totalSuperBasisPoints;
		uint totalFee = _amountOut_preFee - amountOut_postFee;
		toTreasury = totalFee * bipsToTreasury / totalBasisPoints;
		_sendTo = sendTo;
	}

}