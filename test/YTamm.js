const aToken = artifacts.require("dummyAToken");
const aaveWrapper = artifacts.require("AaveWrapper");
const BigMath = artifacts.require("BigMath");
const capitalHandler = artifacts.require("CapitalHandler");
const yieldToken = artifacts.require("YieldToken");
const yieldTokenDeployer = artifacts.require("YieldTokenDeployer");
const ZCBamm = artifacts.require("ZCBamm");
const YTamm = artifacts.require("YTamm");
const FeeOracle = artifacts.require("FeeOracle");

const helper = require("../helper/helper.js");
const YT_U_math = require("../helper/YT-U-Math.js");

const BN = web3.utils.BN;
const nullAddress = "0x0000000000000000000000000000000000000000";
const _10To18BN = (new BN("10")).pow(new BN("18"));
const secondsPerYear = 31556926;
const AcceptableMarginOfError = Math.pow(10, -7);

const MaxFee = "125000000"; //12.5% in super basis points
const AnnualFeeRate = (new BN("2")).pow(new BN("64")).div(new BN("100")); //0.01 or 1% in 64.64 form
const AnnualFeeRateNumber = 0.01;
const LENGTH_RATE_SERIES = 31;

function AmountError(actual, expected) {
	return Math.abs(actual-expected)/expected;
}

async function setRate(amm, rate, account) {
	let amt = (await amm.balanceOf(account)).toString();
	if (amt != "0") {
		await amm.burn(amt);
	}
	/*
		(ZCBreserves+totalSupply)/ Ureserves == rate
		ZCBreserves+totalSupply == rate * Ureserves
		ZCBreserves == rate * Ureserves - totalSupply
	*/
	let Ureserves = 1000000;
	let ZCBreserves = Math.floor(rate*Ureserves - Ureserves).toString();
	await amm.firstMint(Ureserves.toString(), ZCBreserves);
	for (let i = 0; i < LENGTH_RATE_SERIES; i++) {
		await helper.advanceTime(121);
		await amm.forceRateDataUpdate();
	}
	await amm.setOracleRate((await amm.getImpliedRateData())._impliedRates[30].toString());
}

/*
	Here we assume that there are no bugs in the ZCBamm contract which is used as a rate oracle for the YTamm contract
*/
contract('YTamm', async function(accounts){
	it('before each', async () => {
		aTokenInstance = await aToken.new("aCOIN");
		aaveWrapperInstance = await aaveWrapper.new(aTokenInstance.address);
		BigMathInstance = await BigMath.new();
		yieldTokenDeployerInstance = await yieldTokenDeployer.new();
		let timestamp = (await web3.eth.getBlock('latest')).timestamp;
		//maturity is 110 days out
		maturity = timestamp + 110*24*60*60;
		capitalHandlerInstance = await capitalHandler.new(aaveWrapperInstance.address, maturity, yieldTokenDeployerInstance.address, nullAddress);
		yieldTokenInstance = await yieldToken.at(await capitalHandlerInstance.yieldTokenAddress());
		await ZCBamm.link("BigMath", BigMathInstance.address);
		await YTamm.link("BigMath", BigMathInstance.address);
		feeOracleInstance = await FeeOracle.new(MaxFee, AnnualFeeRate, "0", nullAddress);
		amm0 = await ZCBamm.new(capitalHandlerInstance.address, feeOracleInstance.address);


		//simulate generation of 100% returns in money market
		await aTokenInstance.setInflation("2"+_10To18BN.toString().substring(1));

		//mint funds to accounts[0]
		balance = _10To18BN;
		await aTokenInstance.approve(aaveWrapperInstance.address, balance);
		await aaveWrapperInstance.depositUnitAmount(accounts[0], balance);
		await aaveWrapperInstance.approve(capitalHandlerInstance.address, balance);
		await capitalHandlerInstance.depositWrappedToken(accounts[0], balance);
		await capitalHandlerInstance.approve(amm0.address, balance);
		await yieldTokenInstance.approve(amm0.address, balance);

		/*
			make first deposit in amm0
		*/
		Uin = balance.div(new BN("10"));
		ZCBin = balance.div(new BN("30"));
		await amm0.firstMint(Uin, ZCBin);
		/*
			set rate in amm0
		*/
		for (let i = 0; i < LENGTH_RATE_SERIES; i++) {
			await amm0.forceRateDataUpdate();
			//advance 2 minuite
			helper.advanceTime(121);
		}
		let OracleRateString = (await amm0.getImpliedRateData())._impliedRates[0].toString();
		await amm0.setOracleRate(OracleRateString);
		//burn all our amm0 LP tokens
		await amm0.burn(await amm0.balanceOf(accounts[0]));

		amm1 = await YTamm.new(amm0.address, feeOracleInstance.address);
		YTtoLmultiplierBN = await amm1.YTtoLmultiplier();
		YTtoLmultiplierBN_p1 = YTtoLmultiplierBN.add(_10To18BN);
		YTtoLmultiplier = parseInt(YTtoLmultiplierBN.toString()) * Math.pow(10, -18);
		anchor = (await amm0.anchor()).toNumber();

		await capitalHandlerInstance.approve(amm1.address, balance);
		await yieldTokenInstance.approve(amm1.address, balance);

		OracleRate = parseInt(OracleRateString) * Math.pow(2, -64);
		APYo = parseInt((await amm0.getAPYFromOracle()).toString()) * Math.pow(2, -64);
	});

	it('First Liquidity Token Mint', async () => {
		toMint = balance.div((new BN("10")));
		await amm1.firstMint(toMint);
		assert.equal((await amm1.balanceOf(accounts[0])).toString(), toMint.toString(), "correct balance of YTamm liquidity tokens");
		expectedZCBbalance = balance.sub(toMint).toString();
		expectedYTbalance = balance.sub(toMint.mul(YTtoLmultiplierBN_p1).div(_10To18BN)).toString();
		assert.equal((await capitalHandlerInstance.balanceOf(accounts[0])).toString(), expectedZCBbalance, "correct balance ZCB");
		assert.equal((await yieldTokenInstance.balanceOf_2(accounts[0], false)).toString(), expectedYTbalance, "correct balance YT");
		let results = await amm1.getReserves();
		Ureserves = results._Ureserves.toString();
		YTreserves = results._YTreserves.toString();
		assert.equal(Ureserves, toMint.toString(), "correct value of Ureserves");
		assert.equal(YTreserves, toMint.mul(YTtoLmultiplierBN).div(_10To18BN).toString(), "correct value of Ureserves");
		totalSupply = await amm1.totalSupply();
		assert.equal(totalSupply.toString(), toMint.toString(), "correct balance of YTamm liquidity tokens");
	});

	it('Mint Liquidity Tokens', async () => {
		await amm1.mint(toMint, toMint, toMint.mul(YTtoLmultiplierBN).div(_10To18BN));

		let expectedYTin = toMint.mul(new BN(YTreserves));
		expectedYTin = expectedYTin.div(totalSupply).add( new BN(expectedYTin.mod(totalSupply).toString() === "0" ? 0 : 1) );
		let expectedUin = toMint;

		expectedZCBbalance = (new BN(expectedZCBbalance)).sub(expectedUin).toString();
		expectedYTbalance = (new BN(expectedYTbalance)).sub(expectedUin).sub(expectedYTin).toString();
		assert.equal((await amm1.balanceOf(accounts[0])).toString(), toMint.mul(new BN(2)).toString(), "correct balance of YTamm liquidity tokens");
		assert.equal((await capitalHandlerInstance.balanceOf(accounts[0])).toString(), expectedZCBbalance, "correct balance ZCB");
		assert.equal((await yieldTokenInstance.balanceOf_2(accounts[0], false)).toString(), expectedYTbalance, "correct balance YT");
		let expectedUreserves = (new BN(Ureserves)).add(expectedUin).toString();
		let expectedYTreserves = (new BN(YTreserves)).add(expectedYTin).toString();

		let results = await amm1.getReserves();
		Ureserves = results._Ureserves.toString();
		YTreserves = results._YTreserves.toString();
		assert.equal(Ureserves, expectedUreserves, "correct value of Ureserves");
		assert.equal(YTreserves, expectedYTreserves, "correct value of Ureserves");
		totalSupply = await amm1.totalSupply();
		assert.equal(totalSupply.toString(), toMint.mul(new BN(2)).toString(), "correct balance of YTamm liquidity tokens");
	});

	it('Burn Liquidity Tokens', async () => {
		await amm1.burn(toMint);

		let expectedUout = toMint.mul(new BN(Ureserves)).div(totalSupply);
		let expectedYTout = toMint.mul(new BN(YTreserves)).div(totalSupply);

		expectedZCBbalance = (new BN(expectedZCBbalance)).add(expectedUout).toString();
		expectedYTbalance = (new BN(expectedYTbalance)).add(expectedUout).add(expectedYTout).toString();

		amm1balance = await amm1.balanceOf(accounts[0]);
		ZCBbalance = await capitalHandlerInstance.balanceOf(accounts[0]);
		YTbalance = await yieldTokenInstance.balanceOf_2(accounts[0], false);
		assert.equal(amm1balance.toString(), toMint, "correct balance of YTamm liquidity tokens");
		assert.equal(ZCBbalance.toString(), expectedZCBbalance, "correct balance ZCB");
		assert.equal(YTbalance.toString(), expectedYTbalance, "correct balance YT");

		let expectedUreserves = (new BN(Ureserves)).sub(expectedUout).toString();
		let expectedYTreserves = (new BN(YTreserves)).sub(expectedYTout).toString();
		let results = await amm1.getReserves();
		Ureserves = results._Ureserves.toString();
		YTreserves = results._YTreserves.toString();
		assert.equal(Ureserves, expectedUreserves, "correct value of Ureserves");
		assert.equal(YTreserves, expectedYTreserves, "correct value of Ureserves");
		totalSupply = await amm1.totalSupply();
		assert.equal(totalSupply.toString(), amm1balance.toString(), "correct YTamm totalSupply");
	});

	it('SwapFromSpecificYT()', async () => {
		amtIn = toMint.div(new BN("100"));
		rec = await amm1.SwapFromSpecificYT(amtIn);
		let timestamp = (await web3.eth.getBlock(rec.receipt.blockNumber)).timestamp;
		let yearsRemaining = (maturity - timestamp)/secondsPerYear;
		let pctFee = 1 - Math.pow(1 - AnnualFeeRateNumber, yearsRemaining);
		let r = (maturity-timestamp)/anchor;
		let nonFeeAdjustedExpectedUout = YT_U_math.Uout(parseInt(YTreserves.toString()), parseInt(totalSupply.mul(_10To18BN).div(YTtoLmultiplierBN).toString()), r, OracleRate, parseInt(amtIn.toString()));
		let expectedUout = nonFeeAdjustedExpectedUout * (1 - pctFee);
		let prevZCBbalance = ZCBbalance;
		ZCBbalance = await capitalHandlerInstance.balanceOf(accounts[0]);
		let Uout = ZCBbalance.sub(prevZCBbalance);
		let error = Math.abs(parseInt(Uout.toString())/expectedUout - 1);
		assert.isBelow(error, 0.000001, "acceptable margin of error")
		let prevYTbalance = YTbalance;
		YTbalance = await yieldTokenInstance.balanceOf_2(accounts[0], false);
		assert.equal(prevYTbalance.add(Uout).sub(YTbalance).toString(), amtIn.toString(), "correct amount U in");
	});

	it('SwapToSpecificYT()', async () => {
		amtOut = amtIn;
		let results = await amm1.getReserves();
		Ureserves = results._Ureserves;
		YTreserves = results._YTreserves;

		rec = await amm1.SwapToSpecificYT(amtOut);
		let timestamp = (await web3.eth.getBlock(rec.receipt.blockNumber)).timestamp;
		let yearsRemaining = (maturity - timestamp)/secondsPerYear;
		let pctFee = 1 - Math.pow(1 - AnnualFeeRateNumber, yearsRemaining);
		let r = (maturity-timestamp)/anchor;
		let nonFeeAdjustedUin = YT_U_math.Uin(parseInt(YTreserves.toString()), parseInt(totalSupply.mul(_10To18BN).div(YTtoLmultiplierBN).toString()), r, OracleRate, parseInt(amtOut.toString()));
		let expectedUin = nonFeeAdjustedUin / (1 - pctFee);
		let prevZCBbalance = ZCBbalance;
		ZCBbalance = await capitalHandlerInstance.balanceOf(accounts[0]);
		let Uin = prevZCBbalance.sub(ZCBbalance);
		let error = Math.abs(parseInt(Uin.toString())/expectedUin - 1);
		assert.isBelow(error, 0.000001, "acceptable margin of error")
		let prevYTbalance = YTbalance;
		YTbalance = await yieldTokenInstance.balanceOf_2(accounts[0], false);
		assert.equal(YTbalance.sub(prevYTbalance.sub(Uin)).toString(), amtOut.toString(), "correct amount U out");
	});

	it('SwapToSpecificYT() push effective APY over APYo', async () => {
		//process.exit();
		amtOut = amtIn;
		let results = await amm1.getReserves();
		Ureserves = results._Ureserves;
		YTreserves = results._YTreserves;

		rec = await amm1.SwapToSpecificYT(amtOut);
		let timestamp = (await web3.eth.getBlock(rec.receipt.blockNumber)).timestamp;
		let yearsRemaining = (maturity - timestamp)/secondsPerYear;
		let pctFee = 1 - Math.pow(1 - AnnualFeeRateNumber, yearsRemaining);
		let r = (maturity-timestamp)/anchor;
		let nonFeeAdjustedUin = YT_U_math.Uin(parseInt(YTreserves.toString()), parseInt(totalSupply.mul(_10To18BN).div(YTtoLmultiplierBN).toString()), r, OracleRate, parseInt(amtOut.toString()));
		let expectedUin = nonFeeAdjustedUin / (1 - pctFee);
		let prevZCBbalance = ZCBbalance;
		ZCBbalance = await capitalHandlerInstance.balanceOf(accounts[0]);
		let Uin = prevZCBbalance.sub(ZCBbalance);
		let error = Math.abs(parseInt(Uin.toString())/expectedUin - 1);
		assert.isBelow(error, 0.000001, "acceptable margin of error")
		let prevYTbalance = YTbalance;
		YTbalance = await yieldTokenInstance.balanceOf_2(accounts[0], false);
		assert.equal(YTbalance.sub(prevYTbalance.sub(Uin)).toString(), amtOut.toString(), "correct amount U out");
	});

	it('recalibrate() on being stuck at high APY', async () => {
		//first the amm must encur losses
		amt = toMint.mul(YTtoLmultiplierBN).mul(new BN(2)).div(new BN(5)).div(_10To18BN);
		//buy YT, (amm sells YT)
		await amm1.SwapToSpecificYT(amt);
		OracleRate = 2.5;
		await setRate(amm0, OracleRate, accounts[0]);
		//sell YT, (amm buys YT)
		await amm1.SwapFromSpecificYT(amt);
		OracleRate = 1.000001;

		//encur more losses
		await setRate(amm0, OracleRate, accounts[0]);
		//buy YT, (amm sells YT)
		await amm1.SwapToSpecificYT(amt);
		OracleRate = 2.5;
		await setRate(amm0, OracleRate, accounts[0]);
		//sell YT, (amm buys YT)
		await amm1.SwapFromSpecificYT(amt);

		let results = await amm1.getReserves();
		Ureserves = results._Ureserves;
		YTreserves = results._YTreserves;

		let r = parseInt(results._TimeRemaining.toString()) * 2**-64;
		let UpperBound = parseInt(YTreserves.toString());
		while (parseInt(Ureserves.toString()) > 
			YT_U_math.Uout(parseInt(YTreserves.toString()), parseInt(totalSupply.mul(_10To18BN).div(new BN(YTtoLmultiplierBN)).toString()), r, OracleRate, UpperBound) ) {
			UpperBound *= 10;
		}

		let LowerBound = 0;
		let MaxYin = UpperBound/2;
		let step = UpperBound/4;
		for (let i = 0; i < 100; i++) {
			let Uout = YT_U_math.Uout(parseInt(
				YTreserves.toString()),
				parseInt(totalSupply.mul(_10To18BN).div(new BN(YTtoLmultiplierBN)).toString()),
				r,
				OracleRate,
				MaxYin
			);
			if (Uout > parseInt(Ureserves.toString())) {
				MaxYin -= step;
			}
			else if (Uout < parseInt(Ureserves.toString())) {
				MaxYin += step;
			}
			else {
				break;
			}
			step /= 2;
		}
		MaxYin += step*2 + 1;
		let MaxYinStr = Math.floor(MaxYin).toString();

		let prevReserves = await amm1.getReserves();

		await amm1.recalibrate(MaxYinStr);

		let reserves = await amm1.getReserves();

		amtUrevenue = prevReserves._Ureserves.sub(reserves._Ureserves);
		amtYTrevenue = prevReserves._YTreserves.sub(reserves._YTreserves);
	});

	it('recalibrate() on time', async () => {
		let caught = false;
		try {
			await amm1.recalibrate(0);
		}
		catch (err) {
			caught = true;
		}
		if (!caught) {
			assert.fail("recalibration within timeframe passed when it should have failed");
		}

		const _5weeks = 5 * 7 * 24 * 60 * 60;
		await helper.advanceTime(_5weeks);

		let prevReserves = await amm1.getReserves();

		await amm1.recalibrate(0);

		let reserves = await amm1.getReserves();

		amtUrevenue = prevReserves._Ureserves.sub(reserves._Ureserves).add(amtUrevenue);
		amtYTrevenue = prevReserves._YTreserves.sub(reserves._YTreserves).add(amtYTrevenue);
	});

	it('Valid reserves', async () => {
		let results = await amm1.getReserves();
		Ureserves = results._Ureserves.toString();
		YTreserves = results._YTreserves.toString();
		let balZCB = await capitalHandlerInstance.balanceOf(amm1.address);
		let balYT = await yieldTokenInstance.balanceOf_2(amm1.address, false);
		let expectedUreserves = balZCB.sub(amtUrevenue).toString();
		let expectedYTreserves = balYT.sub(balZCB).sub(amtYTrevenue).toString();
		assert.equal(Ureserves, expectedUreserves, "valid Ureserves");
		assert.equal(YTreserves, expectedYTreserves, "valid ZCBreserves");
	});

	it('Yield Generation does not affect pool reserves before contract claim dividend', async () => {
		//simulate generation of yield by sending funds directly to pool address
		amtZCB = balance.div(new BN(1000));
		amtYT = balance.div(new BN(500));
		await capitalHandlerInstance.transfer(amm1.address, amtZCB);
		await yieldTokenInstance.transfer_2(amm1.address, amtYT, true);
		amtZCB = amtZCB.add(amtUrevenue);
		amtYT = amtYT.add(amtYTrevenue).add(amtUrevenue);

		let results = await amm1.getReserves();
		assert.equal(results._Ureserves.toString(), Ureserves, "U reserves not affected by yield generation");
		assert.equal(results._YTreserves.toString(), YTreserves, "U reserves not affected by yield generation");
	});

	it('Contract Claim Dividend', async () => {
		prevInflatedTotalSupply = await amm1.inflatedTotalSupply();

		await amm1.contractClaimDividend();

		let UreservesBN = new BN(Ureserves);
		let YTreservesBN = new BN(YTreserves);
		let CombinedYTBN = UreservesBN.add(YTreservesBN);

		let ZCBUtilizationOverReserves = amtZCB.mul(_10To18BN).div(UreservesBN);
		let YTUtilizationOverReserves = amtYT.mul(_10To18BN).div(CombinedYTBN);

		expectedUreserves = new BN(0);
		expectedYTreserves = new BN(0);
		scaleMultiplier = new BN(0);
		if (ZCBUtilizationOverReserves.cmp(YTUtilizationOverReserves) === 1) {
			scaleMultiplier = YTUtilizationOverReserves.add(_10To18BN);
			let scaledAmtZCB = amtZCB.mul(YTUtilizationOverReserves).div(ZCBUtilizationOverReserves);
			expectedUreserves = UreservesBN.add(scaledAmtZCB);
			expectedYTreserves = YTreservesBN.add(amtYT).sub(scaledAmtZCB);

			amtZCB = amtZCB.sub(scaledAmtZCB);
			amtYT = new BN(0);
		}
		else {
			scaleMultiplier = ZCBUtilizationOverReserves.add(_10To18BN);
			let scaledAmtYT = amtYT.mul(ZCBUtilizationOverReserves).div(YTUtilizationOverReserves);
			expectedUreserves = UreservesBN.add(amtZCB);
			expectedYTreserves = YTreservesBN.add(scaledAmtYT).sub(amtZCB);

			amtZCB = new BN(0);
			amtYT = amtYT.sub(scaledAmtYT);
		}

		assert.equal((await amm1.length()).toString(), "2");
		assert.equal((await amm1.contractBalanceAsset1(1)).toString(), amtZCB.toString());
		assert.equal((await amm1.contractBalanceAsset2(1)).toString(), amtYT.toString());
	})

	it('Yield Generation does not correctly changes pool reserves after contractClaimDividend()', async () => {
		let results = await amm1.getReserves();

		let expectedUreserves2 = parseInt((new BN(Ureserves)).mul(scaleMultiplier).div(_10To18BN).toString());
		let expectedYTreserves2 = parseInt((new BN(YTreserves)).mul(scaleMultiplier).div(_10To18BN).toString());

		Ureserves = results._Ureserves.toString();
		YTreserves = results._YTreserves.toString();

		assert.isBelow(AmountError(parseInt(Ureserves), expectedUreserves2), AcceptableMarginOfError, "Ureserves within error range");
		assert.isBelow(AmountError(parseInt(YTreserves), expectedYTreserves2), AcceptableMarginOfError, "ZCBreserves within error range");

		assert.equal(Ureserves, expectedUreserves, "U reserves correctly changed by yield generation");
		assert.equal(YTreserves, expectedYTreserves, "YT reserves correctly changed by yield generation");
	});

	it('inflatedTotalSupply() changes on contractClaimDividend', async () => {
		let expectedInflatedTotalSupply = prevInflatedTotalSupply.mul(scaleMultiplier).div(_10To18BN);
		let inflatedTotalSupply = await amm1.inflatedTotalSupply();
		let expectedNum = parseInt(expectedInflatedTotalSupply.toString());
		let actualNum = parseInt(inflatedTotalSupply.toString());
		let error = Math.abs(actualNum - expectedNum)/actualNum;
		assert.isBelow(error, AcceptableMarginOfError, "inflatedTotalSupply is within acceptable margin of error");
	});

	it('User Claims Generated Yield', async () => {
		rec = await amm1.claimDividend(accounts[1]);
		let event = rec.logs[2].args;
		assert.equal(event._claimer.toString(), accounts[0]);
		assert.equal(event._to.toString(), accounts[1]);
		assert.equal(event._amtZCB.toString(), amtZCB.toString());
		assert.equal(event._amtYT.toString(), amtYT.toString());
	});

	it('Valid reserves', async () => {
		let results = await amm1.getReserves();
		Ureserves = results._Ureserves.toString();
		YTreserves = results._YTreserves.toString();
		let balZCB = await capitalHandlerInstance.balanceOf(amm1.address);
		let balYT = await yieldTokenInstance.balanceOf_2(amm1.address, false);
		let expectedUreserves = balZCB.toString();
		let expectedYTreserves = balYT.sub(balZCB).toString();
		assert.equal(Ureserves, expectedUreserves, "valid Ureserves");
		assert.equal(YTreserves, expectedYTreserves, "valid ZCBreserves");
	});

	it('ClaimContract Dividend After Dividend Payouts', async () => {
		//advance 1 day and 1 second
		await helper.advanceTime(1 + 24*60*60);

		amtZCB2 = _10To18BN.div(new BN(1000));
		amtYT2 = _10To18BN.div(new BN(1000));

		await capitalHandlerInstance.transfer(amm1.address, amtZCB2);
		await yieldTokenInstance.transfer_2(amm1.address, amtYT2, true);

		await amm1.contractClaimDividend();

		let UreservesBN = new BN(Ureserves);
		let YTreservesBN = new BN(YTreserves);
		let CombinedYTBN = UreservesBN.add(YTreservesBN);

		let ZCBUtilizationOverReserves = amtZCB2.mul(_10To18BN).div(UreservesBN);
		let YTUtilizationOverReserves = amtYT2.mul(_10To18BN).div(CombinedYTBN);

		if (ZCBUtilizationOverReserves.cmp(YTUtilizationOverReserves) === 1) {
			let scaledAmtZCB = amtZCB2.mul(YTUtilizationOverReserves).div(ZCBUtilizationOverReserves);
			expectedUreserves = (new BN(Ureserves)).add(scaledAmtZCB);
			expectedYTreserves = (new BN(YTreserves)).add(amtYT2).sub(scaledAmtZCB);

			amtZCB2 = amtZCB2.sub(scaledAmtZCB);
			amtYT2 = new BN(0);
		}
		else {
			let scaledAmtYT = amtYT2.mul(ZCBUtilizationOverReserves).div(YTUtilizationOverReserves);
			expectedUreserves = (new BN(Ureserves)).add(amtZCB2);
			expectedYTreserves = (new BN(YTreserves)).add(scaledAmtYT).sub(amtZCB2);

			amtZCB2 = new BN(0);
			amtYT2 = amtYT2.sub(scaledAmtYT);
		}


		assert.equal((await amm1.length()).toString(), "3");
		assert.equal((await amm1.contractBalanceAsset1(2)).toString(), amtZCB.add(amtZCB2).toString());
		assert.equal((await amm1.contractBalanceAsset2(2)).toString(), amtYT.add(amtYT2).toString());
	});

	it('Cannot call contractClaimDividend() with no yield generation', async () => {
		//advance 1 day and 1 second
		await helper.advanceTime(1 + 24*60*60);
		let caught = false;
		try {
			await amm1.contractClaimDividend();
		} catch (err) {
			caught = true;
		}
		if (!caught) assert.fail('Cannot Call claimContractDividend() when no yield has been generated');
	});


	it('Claims Dividend On transfer() call', async () => {
		balance = await amm1.balanceOf(accounts[0]);
		amount = balance.div(new BN(2))
		rec = await amm1.transfer(accounts[1], amount);
		/*
			first event is ZCB dividend transfer
			second event is YT dividend transfer
			third event is what we want
			fourth event is transfer of LP tokens
		*/
		let event = rec.logs[2].args;

		assert.equal(event._claimer.toString(), accounts[0]);
		assert.equal(event._to.toString(), accounts[0]);
		assert.equal(event._amtZCB.toString(), amtZCB2.toString());
		assert.equal(event._amtYT.toString(), amtYT2.toString());
	});

	it('Claims Dividend on transferFrom() call', async () => {
		//generate yield for LPs
		amtZCB = _10To18BN.div(new BN(1000));
		amtYT = _10To18BN.div(new BN(5000));
		await capitalHandlerInstance.transfer(amm1.address, amtZCB);
		await yieldTokenInstance.transfer_2(amm1.address, amtYT, true);

		await amm1.contractClaimDividend();

		await amm1.approve(accounts[0], amount, {from: accounts[1]});
		rec = await amm1.transferFrom(accounts[1], accounts[0], amount);

		let results = await amm1.getReserves();
		Ureserves = results._Ureserves.toString();
		YTreserves = results._YTreserves.toString();
		let UreservesBN = new BN(Ureserves);
		let YTreservesBN = new BN(YTreserves);
		let CombinedYTBN = UreservesBN.add(YTreservesBN);

		let ZCBUtilizationOverReserves = amtZCB.mul(_10To18BN).div(UreservesBN);
		let YTUtilizationOverReserves = amtYT.mul(_10To18BN).div(CombinedYTBN);

		expectedUreserves = new BN(0);
		expectedYTreserves = new BN(0);
		if (ZCBUtilizationOverReserves.cmp(YTUtilizationOverReserves) === 1) {
			let scaledAmtZCB = amtZCB.mul(YTUtilizationOverReserves).div(ZCBUtilizationOverReserves);
			expectedUreserves = (new BN(Ureserves)).add(scaledAmtZCB);
			expectedYTreserves = (new BN(YTreserves)).add(amtYT).sub(scaledAmtZCB);

			amtZCB = amtZCB.sub(scaledAmtZCB);
			amtYT = new BN(0);
		}
		else {
			let scaledAmtYT = amtYT.mul(ZCBUtilizationOverReserves).div(YTUtilizationOverReserves);
			expectedUreserves = (new BN(Ureserves)).add(amtZCB);
			expectedYTreserves = (new BN(YTreserves)).add(scaledAmtYT).sub(amtZCB);

			amtZCB = new BN(0);
			amtYT = amtYT.sub(scaledAmtYT);
		}

		let event = rec.logs[2].args;
		assert.equal(event._claimer.toString(), accounts[1]);
		assert.equal(event._to.toString(), accounts[1]);
		assert.equal(event._amtZCB.toString(), amtZCB.div(new BN(2)).toString());
		assert.equal(event._amtYT.toString(), amtYT.div(new BN(2)).toString());

		event = rec.logs[5].args;
		assert.equal(event._claimer.toString(), accounts[0]);
		assert.equal(event._to.toString(), accounts[0]);
		assert.equal(event._amtZCB.toString(), amtZCB.div(new BN(2)).toString());
		assert.equal(event._amtYT.toString(), amtYT.div(new BN(2)).toString());
	});
});
