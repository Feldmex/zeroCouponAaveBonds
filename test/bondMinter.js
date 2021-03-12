const dummyAToken = artifacts.require('dummyAToken');
const dummyVaultHealth = artifacts.require('DummyVaultHealth');
const aaveWrapper = artifacts.require('AaveWrapper');
const capitalHandler = artifacts.require('CapitalHandler');
const yieldTokenDeployer = artifacts.require('YieldTokenDeployer');
const organizer = artifacts.require('organizer');
const BondMinterDelegate = artifacts.require("BondMinterDelegate");
const BondMinter = artifacts.require('BondMinter');
const IERC20 = artifacts.require("IERC20");
const BigMath = artifacts.require("BigMath");
const Ei = artifacts.require("Ei");
const CapitalHandlerDeployer = artifacts.require('CapitalHandlerDeployer');
const ZCBammDeployer = artifacts.require('ZCBammDeployer');
const YTammDeployer = artifacts.require('YTammDeployer');
const SwapRouterDeployer = artifacts.require('SwapRouterDeployer');
const AmmInfoOracle = artifacts.require("AmmInfoOracle");

const helper = require("../helper/helper.js");

const nullAddress = "0x0000000000000000000000000000000000000000";
const BN = web3.utils.BN;
const _10 = new BN(10)
const _10To18 = _10.pow(new BN('18'));

const _8days = 8*24*60*60;

const TOTAL_BASIS_POINTS = 10000;

function basisPointsToABDKString(bips) {
	return (new BN(bips)).mul((new BN(2)).pow(new BN(64))).div(_10.pow(new BN(4))).toString();
}

const ABDK_1 = basisPointsToABDKString(TOTAL_BASIS_POINTS);

contract('BondMinter', async function(accounts) {

	/* 
		for simplicity of testing in this contract we assume that 1 unit of each asset is equal in vaulue to 1 unit of any other asset
	*/
	it('before each', async () => {
		//borrow asset 0
		asset0 = await dummyAToken.new("aCOIN");
		//supply asset 1
		asset1 = await dummyAToken.new("aTOKEN");
		yieldTokenDeployerInstance = await yieldTokenDeployer.new();
		vaultHealthInstance = await dummyVaultHealth.new();
		bondMinterDelegateInstance = await BondMinterDelegate.new();
		bondMinterInstance = await BondMinter.new(vaultHealthInstance.address, bondMinterDelegateInstance.address);
		EiInstance = await Ei.new();
		await BigMath.link("Ei", EiInstance.address);
		BigMathInstance = await BigMath.new();
		await ZCBammDeployer.link("BigMath", BigMathInstance.address);
		await YTammDeployer.link("BigMath", BigMathInstance.address);
		ZCBammDeployerInstance = await ZCBammDeployer.new();
		YTammDeployerInstance = await YTammDeployer.new();
		DeployCapitalHandlerInstance = await CapitalHandlerDeployer.new();
		swapRouterDeployerInstance = await SwapRouterDeployer.new();
		ammInfoOracleInstance = await AmmInfoOracle.new("0", nullAddress);
		organizerInstance = await organizer.new(
			yieldTokenDeployerInstance.address,
			DeployCapitalHandlerInstance.address,
			ZCBammDeployerInstance.address,
			YTammDeployerInstance.address,
			swapRouterDeployerInstance.address,
			ammInfoOracleInstance.address
		);

		maturity = ((await web3.eth.getBlock('latest')).timestamp + _8days).toString();

		await organizerInstance.deployAssetWrapper(asset0.address);
		await organizerInstance.deployAssetWrapper(asset1.address);
		rec0 = await organizerInstance.deployCapitalHandlerInstance(asset0.address, maturity);
		rec1 = await organizerInstance.deployCapitalHandlerInstance(asset1.address, maturity);

		wAsset0 = await aaveWrapper.at(await organizerInstance.assetWrappers(asset0.address));
		wAsset1 = await aaveWrapper.at(await organizerInstance.assetWrappers(asset1.address));

		await asset0.approve(wAsset0.address, _10To18.toString());
		await asset1.approve(wAsset1.address, _10To18.toString());

		await wAsset0.depositUnitAmount(accounts[0], _10To18.toString());
		await wAsset1.depositUnitAmount(accounts[0], _10To18.toString());

		zcbAsset0 = await capitalHandler.at(rec0.receipt.logs[0].args.addr);
		zcbAsset1 = await capitalHandler.at(rec1.receipt.logs[0].args.addr);

		await zcbAsset0.setBondMinterAddress(bondMinterInstance.address);
		await zcbAsset1.setBondMinterAddress(bondMinterInstance.address);

		await bondMinterInstance.whitelistWrapper(wAsset1.address);

		//mint assets to account 0
		await asset1.mintTo(accounts[0], _10To18.mul(new BN("10")).toString());
		await asset1.approve(wAsset1.address, _10To18.mul(new BN("10")).toString());
		await wAsset1.depositUnitAmount(accounts[0], _10To18.mul(new BN("10")).toString());
		await wAsset1.approve(bondMinterInstance.address, _10To18.mul(new BN("10")).toString());
		await wAsset1.approve(zcbAsset1.address, _10To18.mul(new BN("10")).toString());
		await zcbAsset1.depositWrappedToken(accounts[0], _10To18.mul(new BN("10")).toString());
		await zcbAsset1.approve(bondMinterInstance.address, _10To18.mul(new BN("10")).toString());

		//mint assets to account 1
		await asset0.mintTo(accounts[1], _10To18.mul(new BN("10")).toString());
		await asset0.approve(wAsset0.address, _10To18.mul(new BN("10")).toString(), {from: accounts[1]});
		await wAsset0.depositUnitAmount(accounts[1], _10To18.mul(new BN("10")).toString(), {from: accounts[1]});
		await wAsset0.approve(zcbAsset0.address, _10To18.mul(new BN("10")).toString(), {from: accounts[1]});
		await zcbAsset0.depositWrappedToken(accounts[1], _10To18.mul(new BN("10")).toString(), {from: accounts[1]});
		await zcbAsset0.approve(bondMinterInstance.address, _10To18.mul(new BN("10")).toString(), {from: accounts[1]});
	});

	it('assign ratios', async () => {
		//assign ratios in vault

		// asset0 Borrowed * ratio = asset1 Supplied
		// 1.4 * 10**18
		upperRatio = "14" + _10To18.toString().substring(2);
		await vaultHealthInstance.setUpper(asset1.address, zcbAsset0.address, upperRatio);

		// 1.1 * 10**18
		lowerRatio = "11" + _10To18.toString().substring(2);
		await vaultHealthInstance.setLower(asset1.address, zcbAsset0.address, lowerRatio);
	});

	it('cannot open vault without whitelisting supplied asset', async () => {
		let caught = false;
		amountBorrowed = _10To18.mul(_10To18).div(new BN(upperRatio)).toString();
		await vaultHealthInstance.setToReturn(true);
		maxShortInterest0 = _10To18.mul(_10To18).toString();
		await vaultHealthInstance.setMaximumShortInterest(asset0.address, maxShortInterest0);
		try {
			await bondMinterInstance.openVault(zcbAsset1.address, zcbAsset0.address, _10To18.toString(), amountBorrowed, TOTAL_BASIS_POINTS, ABDK_1, ABDK_1);
		} catch (err) {
			caught = true;
		}
		await zcbAsset1.withdrawAll(accounts[0], false);
		if (!caught) assert.fail('only whitelisted assets may be supplied');
	});

	it('opens vault', async () => {
		amountBorrowed = _10To18.mul(_10To18).div(new BN(upperRatio)).toString();
		let caught = false;
		maxShortInterest0 = "0";
		await vaultHealthInstance.setMaximumShortInterest(asset0.address, maxShortInterest0);
		//we are usign a dummy vault health contract, we need to set the value which it will return on vaultWithstandsChange() call
		await vaultHealthInstance.setToReturn(true);
		try {
			await bondMinterInstance.openVault(wAsset1.address, zcbAsset0.address, _10To18.toString(), amountBorrowed, TOTAL_BASIS_POINTS, ABDK_1, ABDK_1);
		} catch (err) {
			caught = true;
		}
		if (!caught) assert.fail('borrowing must be limited by the short interest cap');

		//set max short interest super high so that we will not need to worry about it later in our tests
		maxShortInterest0 = _10To18.mul(_10To18).toString();
		await vaultHealthInstance.setMaximumShortInterest(asset0.address, maxShortInterest0);

		await vaultHealthInstance.setToReturn(false);
		caught = false;
		try {
			await bondMinterInstance.openVault(wAsset1.address, zcbAsset0.address, _10To18.toString(), amountBorrowed, TOTAL_BASIS_POINTS, ABDK_1, ABDK_1);
		} catch (err) {
			caught = true;
		}
		if (!caught) assert.fail('open vault fails when vaultWithstandsChange() returns false');

		await vaultHealthInstance.setToReturn(true);
		caught = false;
		try {
			await bondMinterInstance.openVault(wAsset1.address, zcbAsset0.address, _10To18.toString(), amountBorrowed, TOTAL_BASIS_POINTS-1, ABDK_1, ABDK_1);
		} catch (err) {
			caught = true;
		}
		if (!caught) assert.fail('for call to openVault(), remove(), or borrow() to be sucessful priceChange parameter must be >= TOTAL_BASIS_POINTS');

		caught = false;
		try {
			const sub1ABDK = (new BN(ABDK_1)).sub(new BN(1));
			await bondMinterInstance.openVault(wAsset1.address, zcbAsset0.address, _10To18.toString(), amountBorrowed, TOTAL_BASIS_POINTS, sub1ABDK, ABDK_1);
		} catch (err) {
			caught = true;
		}
		if (!caught) assert.fail('for call to openVault(), remove(), or borrow() to be sucessful suppliedRateChange parameter must be >= ABDK_1');

		caught = false;
		try {
			const over1ABDK = (new BN(ABDK_1)).add(new BN(1));
			await bondMinterInstance.openVault(wAsset1.address, zcbAsset0.address, _10To18.toString(), amountBorrowed, TOTAL_BASIS_POINTS, ABDK_1, over1ABDK);
		} catch (err) {
			caught = true;
		}
		if (!caught) assert.fail('for call to openVault(), remove(), or borrow() to be sucessful borrowedRateChange parameter must be <= ABDK_1');

		amountBorrowed = (new BN(amountBorrowed)).sub(new BN('1')).toString();
		var prevBalanceW1 = await wAsset1.balanceOf(accounts[0]);

		await bondMinterInstance.openVault(wAsset1.address, zcbAsset0.address, _10To18.toString(), amountBorrowed, TOTAL_BASIS_POINTS, ABDK_1, ABDK_1);

		assert.equal((await zcbAsset0.balanceOf(accounts[0])).toString(), amountBorrowed, "correct amount of zcb credited to vault owner");
		assert.equal((await wAsset1.balanceOf(accounts[0])).toString(), prevBalanceW1.sub(_10To18), "correct amount of wAsset1 supplied");


		vaults = await bondMinterInstance.allVaults(accounts[0]);
		assert.equal(vaults.length, 1, "correct amount of vaults");
		vault = vaults[0];

		assert.equal(vault.assetSupplied, wAsset1.address, "correct address for assetSupplied in vault");
		assert.equal(vault.assetBorrowed, zcbAsset0.address, "correct address for assetBorrowed in vault");
		assert.equal(vault.amountSupplied.toString(), _10To18.toString(), "correct vaule of amountSupplied in vault");
		assert.equal(vault.amountBorrowed.toString(), amountBorrowed, "correct vaule of amountBorrowed in vault");
	});

	it('deposits into vault', async () => {
		//process.exit();
		var prevBalanceW1 = await wAsset1.balanceOf(accounts[0]);
		prevSupplied = new BN(vaults[0].amountSupplied);
		await bondMinterInstance.deposit(accounts[0], 0, _10To18.toString());
		currentSupplied = new BN((await bondMinterInstance.vaults(accounts[0], 0)).amountSupplied);

		assert.equal((await wAsset1.balanceOf(accounts[0])).toString(), prevBalanceW1.sub(_10To18).toString(), "correct amount of wAsset1 supplied");
		assert.equal(currentSupplied.sub(_10To18).toString(), prevSupplied.toString(), "correct increase in supplied asset in vault");
	});

	it('removes from vault', async () => {
		var toRemove = currentSupplied.sub(prevSupplied);
		var prevBalanceW1 = await wAsset1.balanceOf(accounts[0]);
		prevSupplied = currentSupplied;

		await vaultHealthInstance.setToReturn(false);
		let caught = false;
		try {
			await bondMinterInstance.remove(0, toRemove.toString(), accounts[0], TOTAL_BASIS_POINTS, ABDK_1, ABDK_1);
		} catch (err) {
			caught = true;
		}
		if (!caught) assert.fail("call to remove() should fail when vaultWithstandsChange() returns false");

		await vaultHealthInstance.setToReturn(true);

		await bondMinterInstance.remove(0, toRemove.toString(), accounts[0], TOTAL_BASIS_POINTS, ABDK_1, ABDK_1);

		currentSupplied = new BN((await bondMinterInstance.vaults(accounts[0], 0)).amountSupplied);
		assert.equal((await wAsset1.balanceOf(accounts[0])).toString(), prevBalanceW1.add(toRemove), "correct amount of wAsset1 supplied");
		assert.equal(prevSupplied.sub(currentSupplied).toString(), toRemove.toString(), "correct increase in supplied asset in vault");
	});


	it('repays vault', async () => {
		toRepay = _10To18.div(new BN('2'));

		var prevBalanceZCB = await zcbAsset0.balanceOf(accounts[0]);
		var prevBorrowed = new BN(vault.amountBorrowed);
		await bondMinterInstance.repay(accounts[0], 0, toRepay.toString());

		var currentBalanceZCB = await zcbAsset0.balanceOf(accounts[0]);
		var currentBorrowed = new BN((await bondMinterInstance.vaults(accounts[0], 0)).amountBorrowed);
		assert.equal(prevBalanceZCB.sub(currentBalanceZCB).toString(), toRepay.toString(), "correct amount repaid");
		assert.equal(prevBorrowed.sub(currentBorrowed).toString(), toRepay.toString(), "correct amount repaid");
	});

	it('borrows from vault', async () => {
		toBorrow = toRepay;
		var prevBalanceZCB = await zcbAsset0.balanceOf(accounts[0]);
		var prevBorrowed = new BN((await bondMinterInstance.vaults(accounts[0], 0)).amountBorrowed);
		await bondMinterInstance.borrow(0, toBorrow.toString(), accounts[0], TOTAL_BASIS_POINTS, ABDK_1, ABDK_1);

		var currentBalanceZCB = await zcbAsset0.balanceOf(accounts[0]);
		currentBorrowed = new BN((await bondMinterInstance.vaults(accounts[0], 0)).amountBorrowed);
		assert.equal(currentBalanceZCB.sub(prevBalanceZCB).toString(), toBorrow.toString(), "correct amount repaid");
		assert.equal(currentBorrowed.sub(prevBorrowed).toString(), toBorrow.toString(), "correct amount repaid");
	});

	it('send undercollateralised vaults to liquidation', async () => {
		/*
			increase collateralisation ratio limits such that the open vault will be sent to liquidation
		*/
		// 1.6 * 10**18
		upperRatio = "16" + _10To18.toString().substring(2);
		await vaultHealthInstance.setUpper(asset1.address, zcbAsset0.address, upperRatio);

		bid = currentBorrowed.sub(new BN("1"));

		caught = false;
		try {
			await bondMinterInstance.auctionLiquidation(accounts[0], 0, zcbAsset0.address, wAsset1.address, bid.toString(), currentSupplied.toString(), {from: accounts[1]});
		} catch (err) {
			caught = true;
		}
		if (!caught) assert.fail("liquidation was triggered despite vault health being above upper limit");

		//get back to original bid value
		bid = bid.add(new BN("1"));

		//increase to new higher bid value
		bid = bid.add(new BN("1"));

		let prevRevenue = await bondMinterInstance.revenue(zcbAsset0.address);
		
		rec = await bondMinterInstance.auctionLiquidation(accounts[0], 0, zcbAsset0.address, wAsset1.address, bid.toString(), currentSupplied.toString(), {from: accounts[1]});

		let timestamp = (await web3.eth.getBlock(rec.receipt.blockNumber)).timestamp;

		let currentRevenue = await bondMinterInstance.revenue(zcbAsset0.address);

		assert.equal(currentRevenue.sub(prevRevenue).toString(), "1", "correct amount of revenue");

		assert.equal((await bondMinterInstance.liquidationsLength()).toString(), "1", "correct length of liquidations array");

		liquidation = await bondMinterInstance.Liquidations(0);

		assert.equal(liquidation.assetBorrowed, zcbAsset0.address, "correct value of liquidation.assetBorrowed");
		assert.equal(liquidation.assetSupplied, wAsset1.address, "correct value of liquidation.assetSupplied");
		assert.equal(liquidation.amountSupplied.toString(), currentSupplied.toString(), "correct value of liquidation.amountSupplied");
		assert.equal(liquidation.bidder, accounts[1], "correct value of liqudiation.bidder");
		assert.equal(liquidation.bidAmount.toString(), bid.toString(), "correct value of liquidation.bidAmount");
		assert.equal(liquidation.bidTimestamp.toString(), timestamp, "correct value of liqudiation.bidTimestamp");

		vault = await bondMinterInstance.vaults(accounts[0], 0);

		assert.equal(vault.assetBorrowed, nullAddress, "assetBorrowed is null");
		assert.equal(vault.assetSupplied, nullAddress, "assetSupplied is null");
		assert.equal(vault.amountBorrowed.toString(), "0", "amountBorrowed is null");
		assert.equal(vault.amountSupplied.toString(), "0", "amountSupplied is null");
	});

	it('bid on liquidation auctions', async () => {
		/*
			bid with account 1
		*/
		bid = bid.add(new BN('10'));
		
		let prevRevenue = await bondMinterInstance.revenue(zcbAsset0.address);

		rec = await bondMinterInstance.bidOnLiquidation(0, bid.toString(), {from: accounts[1]});

		let timestamp = (await web3.eth.getBlock(rec.receipt.blockNumber)).timestamp;

		let currentRevenue = await bondMinterInstance.revenue(zcbAsset0.address);

		assert.equal(currentRevenue.sub(prevRevenue).toString(), "10", "correct amount of revenue");

		liquidation = await bondMinterInstance.Liquidations(0);

		assert.equal(liquidation.assetBorrowed, zcbAsset0.address, "correct value of liquidation.assetBorrowed");
		assert.equal(liquidation.assetSupplied, wAsset1.address, "correct value of liquidation.assetSupplied");
		assert.equal(liquidation.amountSupplied.toString(), currentSupplied.toString(), "correct value of liquidation.amountSupplied");
		assert.equal(liquidation.bidder, accounts[1], "correct value of liqudiation.bidder");
		assert.equal(liquidation.bidAmount.toString(), bid.toString(), "correct value of liquidation.bidAmount");
		assert.equal(liquidation.bidTimestamp.toString(), timestamp, "correct value of liqudiation.bidTimestamp");
	});

	it('claim liquidation auction rewards', async () => {
		//go 30 minuites into the future to claim liquidation
		await helper.advanceTime(30*60 + 1);

		let prevBalW1 = await wAsset1.balanceOf(accounts[1]);

		await bondMinterInstance.claimLiquidation(0, accounts[1], {from: accounts[1]});

		let newBalW1 = await wAsset1.balanceOf(accounts[1]);

		assert.equal(newBalW1.sub(prevBalW1).toString(), liquidation.amountSupplied);
	});

	it('instant liquidations upon dropping below lowerCollateralLimit', async () => {
		/*
			first open vaults
		*/
		amountBorrowed = _10To18.mul(_10To18).div(new BN(upperRatio)).sub(new BN(1)).toString();
		await bondMinterInstance.openVault(wAsset1.address, zcbAsset0.address, _10To18.toString(), amountBorrowed, TOTAL_BASIS_POINTS, ABDK_1, ABDK_1);
		await bondMinterInstance.openVault(wAsset1.address, zcbAsset0.address, _10To18.toString(), amountBorrowed, TOTAL_BASIS_POINTS, ABDK_1, ABDK_1);

		lowerRatio =  _10To18.mul(_10To18).div(new BN(amountBorrowed)).add(new BN(10000)).toString();
		await vaultHealthInstance.setLower(asset1.address, zcbAsset0.address, lowerRatio);

		vaultIndex = (await bondMinterInstance.vaultsLength(accounts[0])).toNumber() - 2;

		await bondMinterInstance.instantLiquidation(accounts[0], vaultIndex, zcbAsset0.address, wAsset1.address, amountBorrowed.toString(), _10To18.toString(), accounts[1], {from: accounts[1]});

		vault = await bondMinterInstance.vaults(accounts[0], vaultIndex);

		assert.equal(vault.assetBorrowed, nullAddress, "assetBorrowed is null");
		assert.equal(vault.assetSupplied, nullAddress, "assetSupplied is null");
		assert.equal(vault.amountBorrowed.toString(), "0", "amountBorrowed is null");
		assert.equal(vault.amountSupplied.toString(), "0", "amountSupplied is null");
	});

	it('partial liquidations Specific In', async () => {
		vaultIndex++;

		await bondMinterInstance.partialLiquidationSpecificIn(accounts[0], vaultIndex, zcbAsset0.address, wAsset1.address,
			(new BN(amountBorrowed)).div(new BN(2)).toString(), _10To18.div(new BN(3)).toString(), accounts[1], {from: accounts[1]});

		vault = await bondMinterInstance.vaults(accounts[0], vaultIndex);

		assert.equal(vault.assetBorrowed, zcbAsset0.address, "assetBorrowed is null");
		assert.equal(vault.assetSupplied, wAsset1.address, "assetSupplied is null");
		assert.equal(vault.amountBorrowed.toString(), (new BN(amountBorrowed)).div(new BN(2)).add(new BN(1)).toString(), "amountBorrowed is correct");
		assert.equal(vault.amountSupplied.toString(), _10To18.div(new BN(2)).add(new BN(1)).toString(), "amountSupplied is correct");
	});

	it('partial liquidation Specific Out', async () => {
		await bondMinterInstance.partialLiquidationSpecificOut(accounts[0], vaultIndex, zcbAsset0.address, wAsset1.address,
			vault.amountSupplied.toString(), vault.amountBorrowed.toString(), accounts[1], {from: accounts[1]});

		vault = await bondMinterInstance.vaults(accounts[0], vaultIndex);

		assert.equal(vault.assetBorrowed, zcbAsset0.address, "assetBorrowed is null");
		assert.equal(vault.assetSupplied, wAsset1.address, "assetSupplied is null");
		assert.equal(vault.amountBorrowed.toString(), "0", "amountBorrowed is correct");
		assert.equal(vault.amountSupplied.toString(), "0", "amountSupplied is correct");
	});

	it('liquidates vaults due to time', async () => {
		await bondMinterInstance.openVault(wAsset1.address, zcbAsset0.address, _10To18.toString(), amountBorrowed, TOTAL_BASIS_POINTS, ABDK_1, ABDK_1);
		await bondMinterInstance.openVault(wAsset1.address, zcbAsset0.address, _10To18.toString(), amountBorrowed, TOTAL_BASIS_POINTS, ABDK_1, ABDK_1);

		vaultIndex = (await bondMinterInstance.vaultsLength(accounts[0])).toNumber() - 2;

		bid = amountBorrowed;

		let caught = false;
		try {
			await bondMinterInstance.auctionLiquidation(accounts[0], vaultIndex, zcbAsset0.address, wAsset1.address, amountBorrowed.toString(), _10To18.toString(), {from: accounts[1]});
		} catch (err) {
			caught = true;
		}
		if (!caught) assert.fail("vault was liquidated while above upper health limit before time liquidation period");


		/*
			advance 1 day to move into 7 day from maturity window
			this allows us to liquidate vaults on the premise of low time to maturity
		*/
		await helper.advanceTime(86401)

		rec = await bondMinterInstance.auctionLiquidation(accounts[0], vaultIndex, zcbAsset0.address, wAsset1.address, amountBorrowed.toString(), _10To18.toString(), {from: accounts[1]});
		let timestamp = (await web3.eth.getBlock(rec.receipt.blockNumber)).timestamp;

		assert.equal((await bondMinterInstance.liquidationsLength()).toString(), "2", "correct length of liquidations array");

		liquidation = await bondMinterInstance.Liquidations(1);

		assert.equal(liquidation.assetBorrowed, zcbAsset0.address, "correct value of liquidation.assetBorrowed");
		assert.equal(liquidation.assetSupplied, wAsset1.address, "correct value of liquidation.assetSupplied");
		assert.equal(liquidation.amountSupplied.toString(), currentSupplied.toString(), "correct value of liquidation.amountSupplied");
		assert.equal(liquidation.bidder, accounts[1], "correct value of liqudiation.bidder");
		assert.equal(liquidation.bidAmount.toString(), bid.toString(), "correct value of liquidation.bidAmount");
		assert.equal(liquidation.bidTimestamp.toString(), timestamp, "correct value of liqudiation.bidTimestamp");

		vault = await bondMinterInstance.vaults(accounts[0], 1);

		assert.equal(vault.assetBorrowed, nullAddress, "assetBorrowed is null");
		assert.equal(vault.assetSupplied, nullAddress, "assetSupplied is null");
		assert.equal(vault.amountBorrowed.toString(), "0", "amountBorrowed is null");
		assert.equal(vault.amountSupplied.toString(), "0", "amountSupplied is null");
	});

	it('instant liquidations due to time to maturity', async () => {
		vaultIndex++;
		let caught = false;

		//change lower ratio so that vault is safe
		lowerRatio =  _10To18.mul(_10To18).div(new BN(amountBorrowed)).toString();
		await vaultHealthInstance.setLower(asset1.address, zcbAsset0.address, lowerRatio);

		try {
			await bondMinterInstance.instantLiquidation(accounts[0], vaultIndex, zcbAsset0.address, wAsset1.address, amountBorrowed.toString(), _10To18.toString(), accounts[1], {from: accounts[1]});
		} catch (err) {
			caught = true;
		}
		if (!caught) assert.fail("vault was subject to instant liquidation with more than 1 day to maturity");

		/*
			first advance 6 days into future so that instant liquidations are allowed because of 1 day to maturity rule
		*/
		let _6days = _8days*3/4;
		await helper.advanceTime(_6days);

		await bondMinterInstance.instantLiquidation(accounts[0], vaultIndex, zcbAsset0.address, wAsset1.address, amountBorrowed.toString(), _10To18.toString(), accounts[1], {from: accounts[1]});

		vault = await bondMinterInstance.vaults(accounts[0], vaultIndex);

		assert.equal(vault.assetBorrowed, nullAddress, "assetBorrowed is null");
		assert.equal(vault.assetSupplied, nullAddress, "assetSupplied is null");
		assert.equal(vault.amountBorrowed.toString(), "0", "amountBorrowed is null");
		assert.equal(vault.amountSupplied.toString(), "0", "amountSupplied is null");
	});

	it('contract owner withdraws revenue', async () => {
		let revenue = await bondMinterInstance.revenue(zcbAsset0.address);

		let caught = false;
		try {
			await bondMinterInstance.claimRevenue(zcbAsset0.address, revenue.add(new BN("1")).toString());
		} catch (err) {
			caught = true;
		}
		if (!caught) assert.fail("more revenue was claimed than is allowed in the revenue[] mapping");

		caught = false;
		try {
			await bondMinterInstance.claimRevenue(zcbAsset0.address, revenue.toString(), {from: accounts[1]});
		} catch (err) {
			caught = true;
		}
		if (!caught) assert.fail("only contract owner should be able to claim revenue");

		let prevBalance = await zcbAsset0.balanceOf(accounts[0]);

		await bondMinterInstance.claimRevenue(zcbAsset0.address, revenue.toString());

		let newRevenue = await bondMinterInstance.revenue(zcbAsset0.address);

		let newBalance = await zcbAsset0.balanceOf(accounts[0]);

		assert.equal(newRevenue.toString(), "0", "revenue storage value reduced to 0 after all is withdrawn");
		assert.equal(newBalance.sub(prevBalance).toString(), revenue.toString(), "correct amount paid to contract owner");
	});

});