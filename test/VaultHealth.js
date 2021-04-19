const dummyAToken = artifacts.require('dummyAToken');
const VaultHealth = artifacts.require('VaultHealth');
const NGBwrapper = artifacts.require('NGBwrapper');
const capitalHandler = artifacts.require('CapitalHandler');
const YieldToken = artifacts.require("YieldToken");
const yieldTokenDeployer = artifacts.require('YieldTokenDeployer');
const organizer = artifacts.require('organizer');
const VaultFactoryDelegate = artifacts.require('VaultFactoryDelegate');
const VaultFactoryDelegate2 = artifacts.require('VaultFactoryDelegate2');
const VaultFactory = artifacts.require('VaultFactory');
const IERC20 = artifacts.require("IERC20");
const BigMath = artifacts.require("BigMath");
const Ei = artifacts.require("Ei");
const CapitalHandlerDeployer = artifacts.require('CapitalHandlerDeployer');
const ZCBammDeployer = artifacts.require('ZCBammDeployer');
const YTammDelegate = artifacts.require('YTammDelegate');
const YTammDeployer = artifacts.require('YTammDeployer');
const AmmInfoOracle = artifacts.require("AmmInfoOracle");
const OracleContainer = artifacts.require("OracleContainer");
const dummyAggregator = artifacts.require("dummyAggregator");
const ZCBamm = artifacts.require("ZCBamm");

const helper = require("../helper/helper.js");

const nullAddress = "0x0000000000000000000000000000000000000000";
const BN = web3.utils.BN;
const DECIMALS = 18;
const _10 = new BN(10);
const _10To18 = _10.pow(new BN('18'));
const _10To19 = _10To18.mul(_10);

const symbol0 = "aETH";
const symbol1 = "aUSDT";
const phrase = symbol0.substring(1)+" / "+symbol1.substring(1);
const _80days = 80*24*60*60;

const LENGTH_RATE_SERIES = 31;

const TotalBasisPoints = 10000;

const SecondsPerYear = 31556926;

const minRateAdjustment = 0.01;

const ErrorRange = 10**-7;

function basisPointsToABDKString(bips) {
	return (new BN(bips)).mul((new BN(2)).pow(new BN(64))).div(_10.pow(new BN(4))).toString();
}

const ABDK_1 = basisPointsToABDKString(TotalBasisPoints);

contract('VaultHealth', async function(accounts) {
	it('before each', async () => {
		//borrow asset 0
		asset0 = await dummyAToken.new(symbol0);
		//supply asset 1
		asset1 = await dummyAToken.new(symbol1);
		aggregator0 = await dummyAggregator.new(DECIMALS, symbol0.substring(1)+" / ETH");
		aggregator1 = await dummyAggregator.new(DECIMALS, symbol1.substring(1)+" / ETH");
		await aggregator0.addRound(_10To18);
		price = 0;
		OracleContainerInstance = await OracleContainer.new(nullAddress.substring(0, nullAddress.length-1)+"1");
		yieldTokenDeployerInstance = await yieldTokenDeployer.new();
		vaultHealthInstance = await VaultHealth.new(OracleContainerInstance.address);
		vaultFactoryDelegateInstance = await VaultFactoryDelegate.new();
		vaultFactoryDelegate2Instance = await VaultFactoryDelegate2.new();
		vaultFactoryInstance = await VaultFactory.new(
			vaultHealthInstance.address,
			vaultFactoryDelegateInstance.address,
			vaultFactoryDelegate2Instance.address
		);
		EiInstance = await Ei.new();
		await BigMath.link("Ei", EiInstance.address);
		BigMathInstance = await BigMath.new();
		await ZCBammDeployer.link("BigMath", BigMathInstance.address);
		await YTammDeployer.link("BigMath", BigMathInstance.address);
		ZCBammDeployerInstance = await ZCBammDeployer.new();
		YTammDelegateInstance = await YTammDelegate.new();
		YTammDeployerInstance = await YTammDeployer.new(YTammDelegateInstance.address);
		CapitalHandlerDeployerInstance = await CapitalHandlerDeployer.new();
		ammInfoOracleInstance = await AmmInfoOracle.new("0", nullAddress);
		organizerInstance = await organizer.new(
			yieldTokenDeployerInstance.address,
			CapitalHandlerDeployerInstance.address,
			ZCBammDeployerInstance.address,
			YTammDeployerInstance.address,
			nullAddress,
			ammInfoOracleInstance.address,
			accounts[4]
		);
		await vaultHealthInstance.setOrganizerAddress(organizerInstance.address);

		maturity = ((await web3.eth.getBlock('latest')).timestamp + _80days).toString();

		let reca = await organizerInstance.deployAssetWrapper(asset0.address);
		let recb = await organizerInstance.deployAssetWrapper(asset1.address);

		wAsset0 = await NGBwrapper.at(reca.receipt.logs[0].args.wrapperAddress);
		wAsset1 = await NGBwrapper.at(recb.receipt.logs[0].args.wrapperAddress);

		let rec0 = await organizerInstance.deployCapitalHandlerInstance(wAsset0.address, maturity);
		let rec1 = await organizerInstance.deployCapitalHandlerInstance(wAsset1.address, maturity);

		await OracleContainerInstance.addAggregators([aggregator0.address, aggregator1.address]);
		await OracleContainerInstance.AddAToken(wAsset0.address, symbol0.substring(1));
		await OracleContainerInstance.AddAToken(wAsset1.address, symbol1.substring(1));

		await asset0.approve(wAsset0.address, _10To18.toString());
		await asset1.approve(wAsset1.address, _10To18.toString());

		await wAsset0.depositUnitAmount(accounts[0], _10To18.toString());
		await wAsset1.depositUnitAmount(accounts[0], _10To18.toString());

		zcbAsset0 = await capitalHandler.at(rec0.receipt.logs[0].args.addr);
		zcbAsset1 = await capitalHandler.at(rec1.receipt.logs[0].args.addr);

		ytAsset0 = await YieldToken.at(await zcbAsset0.yieldTokenAddress());
		ytAsset1 = await YieldToken.at(await zcbAsset1.yieldTokenAddress());

		await organizerInstance.deployZCBamm(zcbAsset0.address);
		await organizerInstance.deployZCBamm(zcbAsset1.address);

		amm0 = await ZCBamm.at(await organizerInstance.ZCBamms(zcbAsset0.address));
		amm1 = await ZCBamm.at(await organizerInstance.ZCBamms(zcbAsset1.address));

		//mint asset0 assets to account 0
		await asset0.mintTo(accounts[0], _10To19.mul(_10));
		await asset0.approve(wAsset0.address, _10To19.mul(_10));
		await wAsset0.depositUnitAmount(accounts[0], _10To19.mul(_10));
		await wAsset0.approve(zcbAsset0.address, _10To19);
		await zcbAsset0.depositWrappedToken(accounts[0], _10To19);
		await wAsset0.approve(vaultFactoryInstance.address, _10To19);
		await zcbAsset0.approve(vaultFactoryInstance.address, _10To19);
		await zcbAsset0.approve(amm0.address, _10To19);
		await ytAsset0.approve(amm0.address, _10To19);

		//mint asset1 assets to account 0
		await asset1.mintTo(accounts[0], _10To19.mul(_10));
		await asset1.approve(wAsset1.address, _10To19.mul(_10));
		await wAsset1.depositUnitAmount(accounts[0], _10To19.mul(_10));
		await wAsset1.approve(zcbAsset1.address, _10To19);
		await zcbAsset1.depositWrappedToken(accounts[0], _10To19);
		await wAsset1.approve(vaultFactoryInstance.address, _10To19);
		await zcbAsset1.approve(vaultFactoryInstance.address, _10To19);
		await zcbAsset1.approve(amm1.address, _10To19);
		await ytAsset1.approve(amm1.address, _10To19);

		//mint assets to account 1
		await asset0.mintTo(accounts[1], _10To19.mul(_10));
		await asset0.approve(wAsset0.address, _10To19.mul(_10), {from: accounts[1]});
		await wAsset0.depositUnitAmount(accounts[1], _10To19.mul(_10), {from: accounts[1]});
		await wAsset0.approve(zcbAsset0.address, _10To19, {from: accounts[1]});
		await zcbAsset0.depositWrappedToken(accounts[1], _10To19, {from: accounts[1]});
		await zcbAsset0.approve(vaultFactoryInstance.address, _10To19, {from: accounts[1]});
		await wAsset0.approve(vaultFactoryInstance.address, _10To19, {from: accounts[1]});

		//add liquidity to amms
		let toSend = _10To18.div(_10).div(_10);
		await amm0.firstMint(toSend, toSend.div(_10));
		await amm1.firstMint(toSend, toSend.div(_10));

		for (let i = 0; i < LENGTH_RATE_SERIES; i++) {
			await amm0.forceRateDataUpdate();
			await amm1.forceRateDataUpdate();
			//advance 2 minuites
			helper.advanceTime(121);
		}

		let OracleRate0String = (await amm0.getImpliedRateData())._impliedRates[0].toString();
		await amm0.setOracleRate(OracleRate0String);

		let OracleRate1String = (await amm1.getImpliedRateData())._impliedRates[0].toString();
		await amm1.setOracleRate(OracleRate1String);

		//mint a few more times such that we have 3 records of the pool apys
		await amm0.mint(_10, _10To18, _10To18);
		await amm0.mint(_10, _10To18, _10To18);
		await amm0.mint(_10, _10To18, _10To18);

		await amm1.mint(_10, _10To18, _10To18);
		await amm1.mint(_10, _10To18, _10To18);
		await amm1.mint(_10, _10To18, _10To18);
	});

	//price inflated by _10Ti18
	//price is of asset0/asset1
	//asset0 is the deposited asset and asset1 is the borrowed asset
	async function setPrice(_price) {
		price = parseInt(_price.toString()) * 10**-18;
		await aggregator1.addRound(_price);
	}


	it('set rate collateralization ratios', async () => {
		//asset0 ratios
		upperRatio0 = 1.07;
		lowerRatio0 = 1.05;
		UpperRatio0Str = basisPointsToABDKString(10700);	//107%
		LowerRatio0Str = basisPointsToABDKString(10500);	//105%
		await vaultHealthInstance.setCollateralizationRatios(wAsset0.address, UpperRatio0Str, LowerRatio0Str);
		let _upper = await vaultHealthInstance.UpperCollateralizationRatio(wAsset0.address);
		let _lower = await vaultHealthInstance.LowerCollateralizationRatio(wAsset0.address);
		assert.equal(_upper.toString(), UpperRatio0Str, "correct lower rate threshold");
		assert.equal(_lower.toString(), LowerRatio0Str, "correct lower rate threshold");

		//asset1 ratios
		upperRatio1 = 1.12;
		lowerRatio1 = 1.09;
		UpperRatio1Str = basisPointsToABDKString(11200);	//112%
		LowerRatio1Str = basisPointsToABDKString(10900);	//109%
		await vaultHealthInstance.setCollateralizationRatios(wAsset1.address, UpperRatio1Str, LowerRatio1Str);
		_upper = await vaultHealthInstance.UpperCollateralizationRatio(wAsset1.address);
		_lower = await vaultHealthInstance.LowerCollateralizationRatio(wAsset1.address);
		assert.equal(_upper.toString(), UpperRatio1Str, "correct lower rate threshold");
		assert.equal(_lower.toString(), LowerRatio1Str, "correct lower rate threshold");
	});

	it('set rate thresholds', async () => {
		//asset0 thresholds
		upperThreshold0 = 1.5;
		lowerThreshold0 = 1.3;
		UpperThreshold0Str = basisPointsToABDKString(15000);	//150%
		LowerThreshold0Str = basisPointsToABDKString(13000);	//130%
		await vaultHealthInstance.setRateThresholds(wAsset0.address, UpperThreshold0Str, LowerThreshold0Str);
		let _upper = await vaultHealthInstance.UpperRateThreshold(wAsset0.address);
		let _lower = await vaultHealthInstance.LowerRateThreshold(wAsset0.address);
		assert.equal(_upper.toString(), UpperThreshold0Str, "correct lower rate threshold");
		assert.equal(_lower.toString(), LowerThreshold0Str, "correct lower rate threshold");

		//asset1 thresholds
		upperThreshold1 = 2.0;
		lowerThreshold1 = 1.5;
		UpperThreshold1Str = basisPointsToABDKString(20000);	//100%
		LowerThreshold1Str = basisPointsToABDKString(15000);	//150%
		await vaultHealthInstance.setRateThresholds(wAsset1.address, UpperThreshold1Str, LowerThreshold1Str);
		_upper = await vaultHealthInstance.UpperRateThreshold(wAsset1.address);
		_lower = await vaultHealthInstance.LowerRateThreshold(wAsset1.address);
		assert.equal(_upper.toString(), UpperThreshold1Str, "correct lower rate threshold");
		assert.equal(_lower.toString(), LowerThreshold1Str, "correct lower rate threshold");
	});

	it('amountSuppliedAtUpperLimit: zcb deposited', async () => {
		await setPrice(_10To18.mul(new BN(3)));
		/*
			asset0 is borrowed
			asset1 is supplied
		*/
		apy0BN = await amm0.getAPYFromOracle();
		apy1BN = await amm1.getAPYFromOracle();
		APY0 = (parseInt(apy0BN.toString()) * 2**-64);
		APY1 = (parseInt(apy1BN.toString()) * 2**-64);

		let adjAPY0 = (APY0-1)/upperThreshold0 + 1;
		let adjAPY1 = (APY1-1)*upperThreshold1 + 1;

		let temp0 = APY0-minRateAdjustment;
		let temp1 = APY1+minRateAdjustment;

		adjAPY0 = Math.min(adjAPY0, temp0);
		adjAPY1 = Math.max(adjAPY1, temp1);

		adjAPY0 = Math.max(adjAPY0, 1);
		adjAPY1 = Math.max(adjAPY1, 1);

		let yearsRemaining = (maturity - (await web3.eth.getBlock('latest')).timestamp)/ SecondsPerYear;

		let rateMultiplier0 = adjAPY0**(-yearsRemaining);
		let rateMultiplier1 = adjAPY1**(-yearsRemaining);

		let amountBorrowed = 10000000;	//asset0
		let collateralizationRatio = upperRatio0*upperRatio1;
		let expectedAmountSupplied = Math.floor(amountBorrowed*rateMultiplier0*price*collateralizationRatio/rateMultiplier1);
		let actualBN = await vaultHealthInstance.amountSuppliedAtUpperLimit(zcbAsset1.address, zcbAsset0.address, amountBorrowed)
		let actual = parseInt(actualBN.toString());

		let error = (expectedAmountSupplied-actual) / expectedAmountSupplied;
		assert.isBelow(error, ErrorRange, "output within acceptable error range");

		let needed = Math.ceil(actual/amountBorrowed) + 1;
		assert.equal(await vaultHealthInstance.satisfiesUpperLimit(zcbAsset1.address, zcbAsset0.address, actualBN, amountBorrowed), false, "correct value returned by satisfiesUpperLimit");
		assert.equal(await vaultHealthInstance.satisfiesUpperLimit(zcbAsset1.address, zcbAsset0.address, actualBN.add(new BN(needed)), amountBorrowed), true, "correct value returned by satisfiesUpperLimit");
	});

	it('amountSuppliedAtUpperLimit: aToken deposited', async () => {
		await setPrice(_10To18.mul(new BN(3)));
		let adjAPY0 = (APY0-1)/upperThreshold0 + 1;

		let temp0 = APY0-minRateAdjustment;

		adjAPY0 = Math.min(adjAPY0, temp0);

		adjAPY0 = Math.max(adjAPY0, 1);

		let yearsRemaining = (maturity - (await web3.eth.getBlock('latest')).timestamp)/ SecondsPerYear;

		let rateMultiplier0 = adjAPY0**(-yearsRemaining);
		let rateMultiplier1 = 1.0;

		let amountBorrowed = 10000000;	//asset0
		let collateralizationRatio = upperRatio0*upperRatio1;
		let expectedAmountSupplied = Math.floor(amountBorrowed*rateMultiplier0*price*collateralizationRatio/rateMultiplier1);
		let actualBN = await vaultHealthInstance.amountSuppliedAtUpperLimit(wAsset1.address, zcbAsset0.address, amountBorrowed)
		let actual = parseInt(actualBN.toString());

		let error = (expectedAmountSupplied-actual) / expectedAmountSupplied;
		assert.isBelow(error, ErrorRange, "output within acceptable error range");

		let needed = Math.ceil(actual/amountBorrowed) + 1;
		assert.equal(await vaultHealthInstance.satisfiesUpperLimit(wAsset1.address, zcbAsset0.address, actualBN, amountBorrowed), false, "correct value returned by satisfiesUpperLimit");
		assert.equal(await vaultHealthInstance.satisfiesUpperLimit(wAsset1.address, zcbAsset0.address, actualBN.add(new BN(needed)), amountBorrowed), true, "correct value returned by satisfiesUpperLimit");
	});

	it('amountSuppliedAtLowerLimit: zcb deposited', async () => {
		await setPrice(_10To18.mul(new BN(3)));
		apy0BN = await amm0.getAPYFromOracle();
		apy1BN = await amm1.getAPYFromOracle();
		APY0 = (parseInt(apy0BN.toString()) * 2**-64);
		APY1 = (parseInt(apy1BN.toString()) * 2**-64);

		let adjAPY0 = (APY0-1)/lowerThreshold0 + 1;
		let adjAPY1 = (APY1-1)*lowerThreshold1 + 1;

		let temp0 = APY0-minRateAdjustment;
		let temp1 = APY1+minRateAdjustment;

		adjAPY0 = Math.min(adjAPY0, temp0);
		adjAPY1 = Math.max(adjAPY1, temp1);

		adjAPY0 = Math.max(adjAPY0, 1);
		adjAPY1 = Math.max(adjAPY1, 1);

		let yearsRemaining = (maturity - (await web3.eth.getBlock('latest')).timestamp)/ SecondsPerYear;

		let rateMultiplier0 = adjAPY0**(-yearsRemaining);
		let rateMultiplier1 = adjAPY1**(-yearsRemaining);

		let amountBorrowed = 10000000;	//asset0
		let collateralizationRatio = lowerRatio0*lowerRatio1;
		let expectedAmountSupplied = Math.floor(amountBorrowed*rateMultiplier0*price*collateralizationRatio/rateMultiplier1);
		let actualBN = await vaultHealthInstance.amountSuppliedAtLowerLimit(zcbAsset1.address, zcbAsset0.address, amountBorrowed)
		let actual = parseInt(actualBN.toString());

		let error = (expectedAmountSupplied-actual) / expectedAmountSupplied;
		assert.isBelow(error, ErrorRange, "output within acceptable error range");

		let needed = Math.ceil(actual/amountBorrowed) + 1;
		assert.equal(await vaultHealthInstance.satisfiesLowerLimit(zcbAsset1.address, zcbAsset0.address, actualBN, amountBorrowed), false, "correct value returned by satisfiesLowerLimit");
		assert.equal(await vaultHealthInstance.satisfiesLowerLimit(zcbAsset1.address, zcbAsset0.address, actualBN.add(new BN(needed)), amountBorrowed), true, "correct value returned by satisfiesLowerLimit");
	});

	it('amountSuppliedAtLowerLimit: aToken deposited', async () => {
		await setPrice(_10To18.mul(new BN(3)));
		let adjAPY0 = (APY0-1)/lowerThreshold0 + 1;

		let temp0 = APY0-minRateAdjustment;

		adjAPY0 = Math.min(adjAPY0, temp0);

		adjAPY0 = Math.max(adjAPY0, 1);

		let yearsRemaining = (maturity - (await web3.eth.getBlock('latest')).timestamp)/ SecondsPerYear;

		let rateMultiplier0 = adjAPY0**(-yearsRemaining);
		let rateMultiplier1 = 1.0;

		let amountBorrowed = 10000000;	//asset0
		let collateralizationRatio = lowerRatio0*lowerRatio1;
		let expectedAmountSupplied = Math.floor(amountBorrowed*rateMultiplier0*price*collateralizationRatio/rateMultiplier1);
		let actualBN = await vaultHealthInstance.amountSuppliedAtLowerLimit(wAsset1.address, zcbAsset0.address, amountBorrowed)
		let actual = parseInt(actualBN.toString());

		let error = (expectedAmountSupplied-actual) / expectedAmountSupplied;
		assert.isBelow(error, ErrorRange, "output within acceptable error range");

		let needed = Math.ceil(actual/amountBorrowed) + 1;
		assert.equal(await vaultHealthInstance.satisfiesLowerLimit(wAsset1.address, zcbAsset0.address, actualBN, amountBorrowed), false, "correct value returned by satisfiesLowerLimit");
		assert.equal(await vaultHealthInstance.satisfiesLowerLimit(wAsset1.address, zcbAsset0.address, actualBN.add(new BN(needed)), amountBorrowed), true, "correct value returned by satisfiesLowerLimit");
	});

	it('amountBorrowedAtUpperLimit: zcb deposited', async () => {
		await setPrice(_10To18.mul(new BN(3)));
		apy0BN = await amm0.getAPYFromOracle();
		apy1BN = await amm1.getAPYFromOracle();
		APY0 = (parseInt(apy0BN.toString()) * 2**-64);
		APY1 = (parseInt(apy1BN.toString()) * 2**-64);

		let adjAPY0 = (APY0-1)/upperThreshold0 + 1;
		let adjAPY1 = (APY1-1)*upperThreshold1 + 1;

		let temp0 = APY0-minRateAdjustment;
		let temp1 = APY1+minRateAdjustment;

		adjAPY0 = Math.min(adjAPY0, temp0);
		adjAPY1 = Math.max(adjAPY1, temp1);

		adjAPY0 = Math.max(adjAPY0, 1);
		adjAPY1 = Math.max(adjAPY1, 1);

		let yearsRemaining = (maturity - (await web3.eth.getBlock('latest')).timestamp)/ SecondsPerYear;

		let rateMultiplier0 = adjAPY0**(-yearsRemaining);
		let rateMultiplier1 = adjAPY1**(-yearsRemaining);

		let amountSupplied = 10000000;	//asset1
		let collateralizationRatio = upperRatio0*upperRatio1;
		let expectedAmountBorrowed = Math.floor(rateMultiplier1/rateMultiplier0/price/collateralizationRatio);
		let actualBN = await vaultHealthInstance.amountBorrowedAtUpperLimit(zcbAsset1.address, zcbAsset0.address, amountSupplied);
		let actual = parseInt(actualBN.toString());

		let error = (expectedAmountBorrowed-actual) / expectedAmountBorrowed;
		assert.isBelow(error, ErrorRange, "output within acceptable error range");

		let needed = new BN(Math.ceil(actual/amountSupplied) + 1);

		assert.equal(await vaultHealthInstance.satisfiesUpperLimit(zcbAsset1.address, zcbAsset0.address, amountSupplied, actualBN), true, "correct value returned by satisfiesUpperLimit");
		assert.equal(await vaultHealthInstance.satisfiesUpperLimit(zcbAsset1.address, zcbAsset0.address, amountSupplied, actualBN.add(new BN(needed))), false, "correct value returned by satisfiesUpperLimit");
	});

	it('amountBorrowedAtUpperLimit: aToken deposited', async () => {
		await setPrice(_10To18.mul(new BN(3)));
		let adjAPY0 = (APY0-1)/upperThreshold0 + 1;

		let temp0 = APY0-minRateAdjustment;

		adjAPY0 = Math.min(adjAPY0, temp0);

		adjAPY0 = Math.max(adjAPY0, 1);

		let yearsRemaining = (maturity - (await web3.eth.getBlock('latest')).timestamp)/ SecondsPerYear;

		let rateMultiplier0 = adjAPY0**(-yearsRemaining);
		let rateMultiplier1 = 1.0;

		let amountSupplied = 10000000;	//asset0
		let collateralizationRatio = upperRatio0*upperRatio1;
		let expectedAmountBorrowed = Math.floor(rateMultiplier1/rateMultiplier0/price/collateralizationRatio);
		let actualBN = await vaultHealthInstance.amountBorrowedAtUpperLimit(wAsset1.address, zcbAsset0.address, amountSupplied);
		let actual = parseInt(actualBN.toString());

		let error = (expectedAmountBorrowed-actual) / expectedAmountBorrowed;
		assert.isBelow(error, ErrorRange, "output within acceptable error range");

		let needed = new BN(Math.ceil(actual/amountSupplied) + 1);
		assert.equal(await vaultHealthInstance.satisfiesUpperLimit(wAsset1.address, zcbAsset0.address, amountSupplied, actualBN), true, "correct value returned by satisfiesUpperLimit");
		assert.equal(await vaultHealthInstance.satisfiesUpperLimit(wAsset1.address, zcbAsset0.address, amountSupplied, actualBN.add(new BN(needed))), false, "correct value returned by satisfiesUpperLimit");
	});

	it('amountBorrowedAtLowerLimit: zcb deposited', async () => {
		await setPrice(_10To18.mul(new BN(3)));
		apy0BN = await amm0.getAPYFromOracle();
		apy1BN = await amm1.getAPYFromOracle();
		APY0 = (parseInt(apy0BN.toString()) * 2**-64);
		APY1 = (parseInt(apy1BN.toString()) * 2**-64);

		let adjAPY0 = (APY0-1)/lowerThreshold0 + 1;
		let adjAPY1 = (APY1-1)*lowerThreshold1 + 1;

		let temp0 = APY0-minRateAdjustment;
		let temp1 = APY1+minRateAdjustment;

		adjAPY0 = Math.min(adjAPY0, temp0);
		adjAPY1 = Math.max(adjAPY1, temp1);

		adjAPY0 = Math.max(adjAPY0, 1);
		adjAPY1 = Math.max(adjAPY1, 1);

		let yearsRemaining = (maturity - (await web3.eth.getBlock('latest')).timestamp)/ SecondsPerYear;

		let rateMultiplier0 = adjAPY0**(-yearsRemaining);
		let rateMultiplier1 = adjAPY1**(-yearsRemaining);

		let amountSupplied = 10000000;	//asset1
		let collateralizationRatio = lowerRatio0*lowerRatio1;
		let expectedAmountBorrowed = Math.floor(amountSupplied * rateMultiplier1/rateMultiplier0/price/collateralizationRatio);
		let actualBN = await vaultHealthInstance.amountBorrowedAtLowerLimit(zcbAsset1.address, zcbAsset0.address, amountSupplied);
		let actual = parseInt(actualBN.toString());

		let error = (expectedAmountBorrowed-actual) / expectedAmountBorrowed;
		assert.isBelow(error, ErrorRange, "output within acceptable error range");

		let needed = new BN(Math.ceil(actual/amountSupplied) + 1);

		assert.equal(await vaultHealthInstance.satisfiesLowerLimit(zcbAsset1.address, zcbAsset0.address, amountSupplied, actualBN), true, "correct value returned by satisfiesLowerLimit");
		assert.equal(await vaultHealthInstance.satisfiesLowerLimit(zcbAsset1.address, zcbAsset0.address, amountSupplied, actualBN.add(new BN(needed))), false, "correct value returned by satisfiesLowerLimit");
	});

	it('amountBorrowedAtLowerLimit: aToken deposited', async () => {
		await setPrice(_10To18.mul(new BN(3)));
		let adjAPY0 = (APY0-1)/lowerThreshold0 + 1;

		let temp0 = APY0-minRateAdjustment;

		adjAPY0 = Math.min(adjAPY0, temp0);

		adjAPY0 = Math.max(adjAPY0, 1);

		let yearsRemaining = (maturity - (await web3.eth.getBlock('latest')).timestamp)/ SecondsPerYear;

		let rateMultiplier0 = adjAPY0**(-yearsRemaining);
		let rateMultiplier1 = 1.0;

		let amountSupplied = 10000000;	//asset0
		let collateralizationRatio = lowerRatio0*lowerRatio1;
		let expectedAmountBorrowed = Math.floor(amountSupplied * rateMultiplier1/rateMultiplier0/price/collateralizationRatio);
		let actualBN = await vaultHealthInstance.amountBorrowedAtLowerLimit(wAsset1.address, zcbAsset0.address, amountSupplied);
		let actual = parseInt(actualBN.toString());

		expectedAmountBorrowed = Math.floor(rateMultiplier1/rateMultiplier0/price/collateralizationRatio);
		let error = (expectedAmountBorrowed-actual) / expectedAmountBorrowed;
		assert.isBelow(error, ErrorRange, "output within acceptable error range");

		let needed = new BN(Math.ceil(actual/amountSupplied) + 1);
		assert.equal(await vaultHealthInstance.satisfiesLowerLimit(wAsset1.address, zcbAsset0.address, amountSupplied, actualBN), true, "correct value returned by satisfiesLowerLimit");
		assert.equal(await vaultHealthInstance.satisfiesLowerLimit(wAsset1.address, zcbAsset0.address, amountSupplied, actualBN.add(new BN(needed))), false, "correct value returned by satisfiesLowerLimit");
	});

	it('YTvaultSatisfiesUpperLimit(): ZCB == YT', async () => {
		await setPrice(_10To18.mul(new BN(3)));
		let adjAPY0 = (APY0-1)/upperThreshold0 + 1;

		let temp0 = APY0-minRateAdjustment;

		adjAPY0 = Math.min(adjAPY0, temp0);

		adjAPY0 = Math.max(adjAPY0, 1);

		let yearsRemaining = (maturity - (await web3.eth.getBlock('latest')).timestamp)/ SecondsPerYear;

		let rateMultiplier0 = adjAPY0**(-yearsRemaining);
		let rateMultiplier1 = 1.0;

		let amountSupplied = 10000000;
		let collateralizationRatio = upperRatio0*upperRatio1;
		let expectedAmountBorrowed = Math.floor(amountSupplied * rateMultiplier1/rateMultiplier0/price/collateralizationRatio);
		let actualBN = await vaultHealthInstance.YTvaultAmountBorrowedAtUpperLimit(zcbAsset1.address, zcbAsset0.address, amountSupplied, 0);
		let actual = parseInt(actualBN.toString());

		let error = (expectedAmountBorrowed-actual) / expectedAmountBorrowed;
		assert.isBelow(error, ErrorRange, "output within acceptable error range");

		let needed = new BN(Math.ceil(actual/amountSupplied) + 1);
		assert.equal(await vaultHealthInstance.YTvaultSatisfiesUpperLimit(zcbAsset1.address, zcbAsset0.address, amountSupplied, 0, actualBN), false, "correct value returned by satisfiesUpperLimit");
		assert.equal(await vaultHealthInstance.YTvaultSatisfiesUpperLimit(zcbAsset1.address, zcbAsset0.address, amountSupplied, 0, actualBN.sub(new BN(needed))), true, "correct value returned by satisfiesUpperLimit");
	});

	it('YTvaultSatisfiesLowerLimit(): ZCB == YT', async () => {
		await setPrice(_10To18.mul(new BN(3)));
		let adjAPY0 = (APY0-1)/lowerThreshold0 + 1;

		let temp0 = APY0-minRateAdjustment;

		adjAPY0 = Math.min(adjAPY0, temp0);

		adjAPY0 = Math.max(adjAPY0, 1);

		let yearsRemaining = (maturity - (await web3.eth.getBlock('latest')).timestamp)/ SecondsPerYear;

		let rateMultiplier0 = adjAPY0**(-yearsRemaining);
		let rateMultiplier1 = 1.0;

		let amountSupplied = 10000000;
		let collateralizationRatio = lowerRatio0*lowerRatio1;
		let expectedAmountBorrowed = Math.floor(amountSupplied * rateMultiplier1/rateMultiplier0/price/collateralizationRatio);
		let actualBN = await vaultHealthInstance.YTvaultAmountBorrowedAtLowerLimit(zcbAsset1.address, zcbAsset0.address, amountSupplied, 0);
		let actual = parseInt(actualBN.toString());

		let error = (expectedAmountBorrowed-actual) / expectedAmountBorrowed;
		assert.isBelow(error, ErrorRange, "output within acceptable error range");

		let needed = new BN(Math.ceil(actual/amountSupplied) + 1);
		assert.equal(await vaultHealthInstance.YTvaultSatisfiesLowerLimit(zcbAsset1.address, zcbAsset0.address, amountSupplied, 0, actualBN), false, "correct value returned by satisfiesLowerLimit");
		assert.equal(await vaultHealthInstance.YTvaultSatisfiesLowerLimit(zcbAsset1.address, zcbAsset0.address, amountSupplied, 0, actualBN.sub(new BN(needed))), true, "correct value returned by satisfiesLowerLimit");
	});

	it('YTvaultSatisfiesUpperLimit(): ZCB > YT', async () => {
		await setPrice(_10To18.mul(new BN(3)));
		let adjAPY0 = (APY0-1)/upperThreshold0 + 1;

		let temp0 = APY0-minRateAdjustment;

		adjAPY0 = Math.min(adjAPY0, temp0);

		adjAPY0 = Math.max(adjAPY0, 1);

		let adjAPY1 = (APY1-1)*upperThreshold1 + 1;

		let temp1 = APY1+minRateAdjustment;

		adjAPY1 = Math.max(adjAPY1, temp1);

		let yearsRemaining = (maturity - (await web3.eth.getBlock('latest')).timestamp)/ SecondsPerYear;

		let rateMultiplier0 = adjAPY0**(-yearsRemaining);
		let rateMultiplier1 = adjAPY1**(-yearsRemaining);

		let amountSupplied = 10000000
		let amountBond = 2000000;
		let collateralizationRatio = upperRatio0*upperRatio1;
		let expectedBorrowFromUnderlying = Math.floor(amountSupplied/rateMultiplier0/price/collateralizationRatio);
		let expectedBorrowFromZCB = Math.floor(amountBond*rateMultiplier1/rateMultiplier0/price/collateralizationRatio);
		let expectedAmountBorrowed = expectedBorrowFromUnderlying+expectedBorrowFromZCB;
		let actualBN = await vaultHealthInstance.YTvaultAmountBorrowedAtUpperLimit(zcbAsset1.address, zcbAsset0.address, amountSupplied, amountBond);
		let actual = parseInt(actualBN.toString());

		let error = (expectedAmountBorrowed-actual) / expectedAmountBorrowed;
		assert.isBelow(error, ErrorRange, "output within acceptable error range");

		let needed = new BN(Math.ceil(actual/(amountSupplied+amountBond)) + 1);
		assert.equal(await vaultHealthInstance.YTvaultSatisfiesUpperLimit(zcbAsset1.address, zcbAsset0.address, amountSupplied, amountBond, actualBN), false, "correct value returned by satisfiesUpperLimit");
		assert.equal(await vaultHealthInstance.YTvaultSatisfiesUpperLimit(zcbAsset1.address, zcbAsset0.address, amountSupplied, amountBond, actualBN.sub(new BN(needed))), true, "correct value returned by satisfiesUpperLimit");
	});

	it('YTvaultSatisfiesLowerLimit(): ZCB > YT', async () => {
		await setPrice(_10To18.mul(new BN(3)));
		let adjAPY0 = (APY0-1)/upperThreshold0 + 1;

		let temp0 = APY0-minRateAdjustment;

		adjAPY0 = Math.min(adjAPY0, temp0);

		adjAPY0 = Math.max(adjAPY0, 1);

		let adjAPY1 = (APY1-1)*lowerThreshold1 + 1;

		let temp1 = APY1+minRateAdjustment;

		adjAPY1 = Math.max(adjAPY1, temp1);

		let yearsRemaining = (maturity - (await web3.eth.getBlock('latest')).timestamp)/ SecondsPerYear;

		let rateMultiplier0 = adjAPY0**(-yearsRemaining);
		let rateMultiplier1 = adjAPY1**(-yearsRemaining);

		let amountSupplied = 10000000
		let amountBond = 2000000;
		let collateralizationRatio = lowerRatio0*lowerRatio1;
		let expectedBorrowFromUnderlying = Math.floor(amountSupplied/rateMultiplier0/price/collateralizationRatio);
		let expectedBorrowFromZCB = Math.floor(amountBond*rateMultiplier1/rateMultiplier0/price/collateralizationRatio);
		let expectedAmountBorrowed = expectedBorrowFromUnderlying+expectedBorrowFromZCB;
		let actualBN = await vaultHealthInstance.YTvaultAmountBorrowedAtLowerLimit(zcbAsset1.address, zcbAsset0.address, amountSupplied, amountBond);
		let actual = parseInt(actualBN.toString());

		let error = (expectedAmountBorrowed-actual) / expectedAmountBorrowed;
		assert.isBelow(error, ErrorRange, "output within acceptable error range");

		let needed = new BN(Math.ceil(actual/(amountSupplied+amountBond)) + 1);
		assert.equal(await vaultHealthInstance.YTvaultSatisfiesLowerLimit(zcbAsset1.address, zcbAsset0.address, amountSupplied, amountBond, actualBN), false, "correct value returned by satisfiesLowerLimit");
		assert.equal(await vaultHealthInstance.YTvaultSatisfiesLowerLimit(zcbAsset1.address, zcbAsset0.address, amountSupplied, amountBond, actualBN.sub(new BN(needed))), true, "correct value returned by satisfiesLowerLimit");
	});

	it('YTvaultSatisfiesUpperLimit(): ZCB < YT', async () => {
		await setPrice(_10To18.mul(new BN(3)));
		let adjAPY0 = (APY0-1)/upperThreshold0 + 1;

		let temp0 = APY0-minRateAdjustment;

		adjAPY0 = Math.min(adjAPY0, temp0);

		adjAPY0 = Math.max(adjAPY0, 1);

		let adjAPY1 = (APY1-1)/upperThreshold1 + 1;

		let temp1 = APY1-minRateAdjustment;

		adjAPY1 = Math.min(adjAPY1, temp1);

		adjAPY1 = Math.max(adjAPY1, 1);

		let yearsRemaining = (maturity - (await web3.eth.getBlock('latest')).timestamp)/ SecondsPerYear;

		let rateMultiplier0 = adjAPY0**(-yearsRemaining);
		let rateMultiplier1 = adjAPY1**(-yearsRemaining);

		let amountSupplied = 10000000
		let amountBond = -2000000;
		let collateralizationRatio = upperRatio0*upperRatio1;
		let expectedBorrowFromUnderlying = Math.floor(amountSupplied/rateMultiplier0/price/collateralizationRatio);
		let expectedBorrowFromZCB = Math.floor(amountBond*rateMultiplier1/rateMultiplier0/price/collateralizationRatio);
		let expectedAmountBorrowed = expectedBorrowFromUnderlying+expectedBorrowFromZCB;
		let actualBN = await vaultHealthInstance.YTvaultAmountBorrowedAtUpperLimit(zcbAsset1.address, zcbAsset0.address, amountSupplied, amountBond);
		let actual = parseInt(actualBN.toString());

		let error = (expectedAmountBorrowed-actual) / expectedAmountBorrowed;
		assert.isBelow(error, ErrorRange, "output within acceptable error range");

		let needed = new BN(Math.ceil(actual/(amountSupplied-amountBond)) + 1);
		assert.equal(await vaultHealthInstance.YTvaultSatisfiesUpperLimit(zcbAsset1.address, zcbAsset0.address, amountSupplied, amountBond, actualBN), false, "correct value returned by satisfiesUpperLimit");
		assert.equal(await vaultHealthInstance.YTvaultSatisfiesUpperLimit(zcbAsset1.address, zcbAsset0.address, amountSupplied, amountBond, actualBN.sub(new BN(needed))), true, "correct value returned by satisfiesUpperLimit");
	});

	it('YTvaultSatisfiesLowerLimit(): ZCB < YT', async () => {
		await setPrice(_10To18.mul(new BN(3)));
		let adjAPY0 = (APY0-1)/lowerThreshold0 + 1;

		let temp0 = APY0-minRateAdjustment;

		adjAPY0 = Math.min(adjAPY0, temp0);

		adjAPY0 = Math.max(adjAPY0, 1);

		let adjAPY1 = (APY1-1)/lowerThreshold1 + 1;

		let temp1 = APY1-minRateAdjustment;

		adjAPY1 = Math.min(adjAPY1, temp1);

		adjAPY1 = Math.max(adjAPY1, 1);

		let yearsRemaining = (maturity - (await web3.eth.getBlock('latest')).timestamp)/ SecondsPerYear;

		let rateMultiplier0 = adjAPY0**(-yearsRemaining);
		let rateMultiplier1 = adjAPY1**(-yearsRemaining);

		let amountSupplied = 10000000
		let amountBond = -2000000;
		let collateralizationRatio = lowerRatio0*lowerRatio1;
		let expectedBorrowFromUnderlying = Math.floor(amountSupplied/rateMultiplier0/price/collateralizationRatio);
		let expectedBorrowFromZCB = Math.floor(amountBond*rateMultiplier1/rateMultiplier0/price/collateralizationRatio);
		let expectedAmountBorrowed = expectedBorrowFromUnderlying+expectedBorrowFromZCB;
		let actualBN = await vaultHealthInstance.YTvaultAmountBorrowedAtLowerLimit(zcbAsset1.address, zcbAsset0.address, amountSupplied, amountBond);
		let actual = parseInt(actualBN.toString());

		let error = (expectedAmountBorrowed-actual) / expectedAmountBorrowed;
		assert.isBelow(error, ErrorRange, "output within acceptable error range");

		let needed = new BN(Math.ceil(actual/(amountSupplied-amountBond)) + 1);
		assert.equal(await vaultHealthInstance.YTvaultSatisfiesLowerLimit(zcbAsset1.address, zcbAsset0.address, amountSupplied, amountBond, actualBN), false, "correct value returned by satisfiesLowerLimit");
		assert.equal(await vaultHealthInstance.YTvaultSatisfiesLowerLimit(zcbAsset1.address, zcbAsset0.address, amountSupplied, amountBond, actualBN.sub(new BN(needed))), true, "correct value returned by satisfiesLowerLimit");
	});

	it('vaultWithstandsChange: aToken deposited', async () => {
		await setPrice(_10To18.mul(new BN(3)));
		apy0BN = await amm0.getAPYFromOracle();
		APY0 = (parseInt(apy0BN.toString()) * 2**-64);

		let adjAPY0 = (APY0-1)/upperThreshold0 + 1;

		let temp0 = APY0-minRateAdjustment;

		adjAPY0 = Math.min(adjAPY0, temp0);

		adjAPY0 = Math.max(adjAPY0, 1);

		let yearsRemaining = (maturity - (await web3.eth.getBlock('latest')).timestamp)/ SecondsPerYear;

		let rateMultiplier0 = adjAPY0**(-yearsRemaining);
		let rateMultiplier1 = 1.0;

		let amountSupplied = 10000000;	//asset1
		let collateralizationRatio = upperRatio0*upperRatio1;
		let expectedAmountBorrowed = Math.floor(rateMultiplier1/rateMultiplier0/price/collateralizationRatio);
		let actualBN = await vaultHealthInstance.amountBorrowedAtUpperLimit(wAsset1.address, zcbAsset0.address, amountSupplied);
		let actual = parseInt(actualBN.toString());

		let res = await vaultHealthInstance.vaultWithstandsChange(wAsset1.address, zcbAsset0.address, amountSupplied, actualBN, TotalBasisPoints, ABDK_1, ABDK_1);
		assert.equal(res, true, "correct value returned by vaultWithstandsChange");

		res = await vaultHealthInstance.vaultWithstandsChange(wAsset1.address, zcbAsset0.address, amountSupplied, actualBN, TotalBasisPoints+1, ABDK_1, ABDK_1);
		assert.equal(res, false, "correct value returned by vaultWithstandsChange");

		const _0 = "0";

		rateMultiplier0 = 1.0;
		rateMultiplier1 = 1.0;

		let priceChange = Math.floor(TotalBasisPoints * amountSupplied / (actual * price * collateralizationRatio * rateMultiplier0 / rateMultiplier1));

		res = await vaultHealthInstance.vaultWithstandsChange(wAsset1.address, zcbAsset0.address, amountSupplied, actualBN, priceChange, _0, _0);
		assert.equal(res, true, "correct value returned by vaultWithstandsChange");

		res = await vaultHealthInstance.vaultWithstandsChange(wAsset1.address, zcbAsset0.address, amountSupplied, actualBN, priceChange+1, _0, _0);
		assert.equal(res, false, "correct value returned by vaultWithstandsChange");

		const rateChange0 = 2.43;
		const rateChange0Str = basisPointsToABDKString(24300);

		adjAPY0 = (APY0-1)/upperThreshold0*rateChange0 + 1;

		temp0 = (APY0-1)*rateChange0-minRateAdjustment + 1;

		adjAPY0 = Math.min(adjAPY0, temp0);

		adjAPY0 = Math.max(adjAPY0, 1);

		rateMultiplier0 = adjAPY0**(-yearsRemaining);

		priceChange = Math.floor(TotalBasisPoints * amountSupplied / (actual * price * collateralizationRatio * rateMultiplier0 / rateMultiplier1));

		res = await vaultHealthInstance.vaultWithstandsChange(wAsset1.address, zcbAsset0.address, amountSupplied, actualBN, priceChange, _0, rateChange0Str);
		assert.equal(res, true, "correct value returned by vaultWithstandsChange");

		res = await vaultHealthInstance.vaultWithstandsChange(wAsset1.address, zcbAsset0.address, amountSupplied, actualBN, priceChange+1, _0, rateChange0Str);
		assert.equal(res, false, "correct value returned by vaultWithstandsChange");
	});

	it('vaultWithstandsChange: zcb deposited', async () => {
		await setPrice(_10To18.mul(new BN(3)));
		apy0BN = await amm0.getAPYFromOracle();
		apy1BN = await amm1.getAPYFromOracle();
		APY0 = (parseInt(apy0BN.toString()) * 2**-64);
		APY1 = (parseInt(apy1BN.toString()) * 2**-64);

		let adjAPY0 = (APY0-1)/upperThreshold0 + 1;
		let adjAPY1 = (APY1-1)*upperThreshold1 + 1;

		let temp0 = APY0-minRateAdjustment;
		let temp1 = APY1+minRateAdjustment;

		adjAPY0 = Math.min(adjAPY0, temp0);
		adjAPY1 = Math.max(adjAPY1, temp1);

		adjAPY0 = Math.max(adjAPY0, 1);
		adjAPY1 = Math.max(adjAPY1, 1);

		let yearsRemaining = (maturity - (await web3.eth.getBlock('latest')).timestamp)/ SecondsPerYear;

		let rateMultiplier0 = adjAPY0**(-yearsRemaining);
		let rateMultiplier1 = adjAPY1**(-yearsRemaining);

		let amountSupplied = 10000000;	//asset1
		let collateralizationRatio = upperRatio0*upperRatio1;
		let expectedAmountBorrowed = Math.floor(rateMultiplier1/rateMultiplier0/price/collateralizationRatio);
		let actualBN = await vaultHealthInstance.amountBorrowedAtUpperLimit(zcbAsset1.address, zcbAsset0.address, amountSupplied);
		let actual = parseInt(actualBN.toString());

		let res = await vaultHealthInstance.vaultWithstandsChange(zcbAsset1.address, zcbAsset0.address, amountSupplied, actualBN, TotalBasisPoints, ABDK_1, ABDK_1);
		assert.equal(res, true, "correct value returned by vaultWithstandsChange");

		res = await vaultHealthInstance.vaultWithstandsChange(zcbAsset1.address, zcbAsset0.address, amountSupplied, actualBN, TotalBasisPoints+1, ABDK_1, ABDK_1);
		assert.equal(res, false, "correct value returned by vaultWithstandsChange");

		const _0 = "0";

		adjAPY0 = 1.0;
		adjAPY1 = 1.0+minRateAdjustment;

		rateMultiplier0 = 1.0;
		rateMultiplier1 = adjAPY1**(-yearsRemaining);

		let priceChange = Math.floor(TotalBasisPoints * amountSupplied / (actual * price * collateralizationRatio * rateMultiplier0 / rateMultiplier1));

		res = await vaultHealthInstance.vaultWithstandsChange(zcbAsset1.address, zcbAsset0.address, amountSupplied, actualBN, priceChange, _0, _0);
		assert.equal(res, true, "correct value returned by vaultWithstandsChange");

		res = await vaultHealthInstance.vaultWithstandsChange(zcbAsset1.address, zcbAsset0.address, amountSupplied, actualBN, priceChange+1, _0, _0);
		assert.equal(res, false, "correct value returned by vaultWithstandsChange");

		const rateChange0 = 1.5;
		const rateChange1 = 0.94;
		const rateChange0Str = basisPointsToABDKString(15000);
		const rateChange1Str = basisPointsToABDKString(9400);

		adjAPY0 = (APY0-1)/upperThreshold0*rateChange0 + 1;
		adjAPY1 = (APY1-1)*upperThreshold1*rateChange1 + 1;

		temp0 = (APY0-1)*rateChange0-minRateAdjustment + 1;
		temp1 = (APY1-1)*rateChange1+minRateAdjustment + 1;

		adjAPY0 = Math.min(adjAPY0, temp0);
		adjAPY1 = Math.max(adjAPY1, temp1);

		adjAPY0 = Math.max(adjAPY0, 1);
		adjAPY1 = Math.max(adjAPY1, 1);

		rateMultiplier0 = adjAPY0**(-yearsRemaining);
		rateMultiplier1 = adjAPY1**(-yearsRemaining);

		priceChange = Math.floor(TotalBasisPoints * amountSupplied / (actual * price * collateralizationRatio * rateMultiplier0 / rateMultiplier1));

		res = await vaultHealthInstance.vaultWithstandsChange(zcbAsset1.address, zcbAsset0.address, amountSupplied, actualBN, priceChange, rateChange1Str, rateChange0Str);
		assert.equal(res, true, "correct value returned by vaultWithstandsChange");

		res = await vaultHealthInstance.vaultWithstandsChange(zcbAsset1.address, zcbAsset0.address, amountSupplied, actualBN, priceChange+1, rateChange1Str, rateChange0Str);
		assert.equal(res, false, "correct value returned by vaultWithstandsChange");
	});

	it('set maximum short interest', async () => {
		let setTo = '23123123123';

		let caught = false;
		try {
			await vaultHealthInstance.setMaximumShortInterest(wAsset0.address, setTo, {from: accounts[1]});
		} catch (err) {
			caught = true;
		}
		if (!caught) {
			assert.fail('setMaximumShortInterest() should be onlyOwner');
		}

		await vaultHealthInstance.setMaximumShortInterest(wAsset0.address, setTo);

		assert.equal((await vaultHealthInstance.maximumShortInterest(wAsset0.address)).toString(), setTo, "correct value for maximum short interest");
	});
});
