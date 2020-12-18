pragma solidity >=0.6.5 <0.7.0;

interface IAaveWrapper {
	function firstDeposit(address _to, uint _amountAToken) external returns (uint _amountWrappedToken);
	function deposit(address _to, uint _amountAToken) external returns (uint _amountWrappedToken);
	function withdrawAToken(address _to, uint _amountAToken) external returns (uint _amountWrappedToken);
	function withdrawWrappedToken(address _to, uint _amountWrappedToken) external returns (uint _amountAToken);

	function balanceAToken(address _owner) external view returns (uint balance);
	function ATokenToWrappedToken(uint _amountAToken) external view returns (uint _amountWrappedToken);
	function WrappedTokenToAToken(uint _amountWrappedToken) external view returns (uint _amountAToken);


}


