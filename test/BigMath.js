const BigMath = artifacts.require("BigMath");
const BN = web3.utils.BN;
const _10To18 = (new BN('10')).pow(new BN('18'));


const addition_series_data_array = [
	3.532638989211429e21, 8.123575301925086e21,
	1.914547520851727e22, 4.597351009781708e22,
	1.1199767955048595e23, 2.7595467055933305e23,
	6.861762397213119e23, 1.7190984485914473e24,
	4.334170479517456e24, 1.0986161322763805e25,
	2.797703108389213e25, 7.1534708728861e25,
	1.835618393612818e26, 4.7252538897488815e26,
	1.2198312830141285e27, 3.1570619510569525e27,
	8.189734001592899e27, 2.128967126497089e28,
	5.5450007070812015e28, 1.4467672526275159e29,
	3.780936367779663e29, 9.895777734762272e29,
	2.5935973811247214e30, 6.806354363991228e30,
	1.788329890071965e31, 4.704000104541168e31,
	1.2386324902270515e32, 3.264711636491927e32,
	8.612886291792749e32, 2.2742106798878982e33,
	6.00992892534685e33, 1.5894430796449978e34,
	4.2066807430832585e34, 1.1141313708614602e35,
	2.9527056022310355e35, 7.830266715673091e35,
	2.077745864657038e36, 5.516396839118708e36,
	1.4653938605367742e37, 3.894739269536102e37,
	1.0356610276733984e38, 2.755261428205564e38,
	7.333397495026503e38, 1.9527053469860518e39
];


contract('BigMath', async function(accounts){
	it('before each', async () => {
		instance = await BigMath.new();
	});


	it('correct values of addition series data', async () => {
		for (let i = 0; i < 44; i++) {
			res = parseInt((await instance.addition_series_data(i)).toString());
			if (Math.abs(res/addition_series_data_array[i] - 1)> 0.00001) {
				console.log(i, res, addition_series_data_array[i]);
				assert.fail('wrong value returned from addition series data');
			}
		}
	});
});
