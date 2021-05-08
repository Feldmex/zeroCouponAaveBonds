pragma solidity >=0.6.0 <0.7.0;

interface IVaultManagerFlashReceiver {
	function onFlashLoan(
		address _vaultOwner,
		address _prevStateAssetSupplied,
		address _prevStateAssetBorrowed,
		uint _prevStateAmountSupplied,
		uint _prevStateAmountBorrowed,
		bytes calldata _data
	) external returns (bool);
}