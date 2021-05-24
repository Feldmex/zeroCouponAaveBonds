// SPDX-License-Identifier: MIT
pragma solidity >=0.6.8 <0.7.0;

import "./DividendEnabled.sol";
import "./IYTammData.sol";

abstract contract IYTamm is DividendEnabled, IYTammData {
	event Mint(
		address user,
		uint amount
	);

	event Burn(
		address user,
		uint amount
	);

	event Swap(
		address user,
		uint amountYT,
		uint amountU,
		bool YTin
	);

	function firstMint(uint128 _Uin) external virtual;
	function mint(uint _amount, uint _maxUin, uint _maxYTin) external virtual;
	function burn(uint _amount) external virtual;
	function SwapFromSpecificYT(int128 _amount) external virtual returns (uint);
	function SwapToSpecificYT(int128 _amount) external virtual returns (uint);
	function SwapFromSpecificYTWithLimit(int128 _amount, uint _minUout) external virtual returns (uint);
	function SwapToSpecificYTWithLimit(int128 _amount, uint _maxUin) external virtual returns (uint);
	function ReserveQuoteFromYT(int128 _amount) external virtual returns (uint);
	function ReserveQuoteToYT(int128 _amount) external virtual returns (uint);
	function TakeQuote(uint _amountU, int128 _amountYT, bool _YTin) external virtual;
	function recalibrate(int128 _approxYTin) external virtual;
	function inflatedTotalSupply() external virtual view returns (uint);
	function getReserves() external virtual view returns (
		uint _Ureserves,
		uint _YTreserves,
		uint _TimeRemaining
	);

	string public constant override name = "YT amm Liquidity Token";
	string public constant override symbol = "YTLT";
}
