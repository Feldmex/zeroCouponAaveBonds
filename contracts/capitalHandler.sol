pragma solidity >=0.6.5 <0.7.0;
import "./interfaces/IERC20.sol";
import "./ERC20.sol";
import "./aaveWrapper.sol";
import "./libraries/SafeMath.sol";
import "./libraries/SignedSafeMath.sol";

contract capitalHandler is IERC20 {
	using SafeMath for uint;
	using SignedSafeMath for int;

	bool public inPayoutPhase;

	uint64 public maturity;

	//1e18 * aToken / wrappedToken
	uint public maturityConversionRate;

	aaveWrapper public aw;

	address public aToken;

	mapping(address => int) public balanceBonds;

	mapping(address => uint) public balanceYield;

//--------ERC 20 Storage---------------

	uint8 public override decimals;
    mapping(address => mapping(address => uint256)) public override allowance;
    string public override name;
    string public override symbol;

//--------------functionality----------

	constructor(address _aw, uint64 _maturity) public {
		aaveWrapper temp = aaveWrapper(_aw);
		aw = temp;
		decimals = temp.decimals();
		IERC20 temp2 = IERC20(temp.aToken());
		aToken = address(temp2);
		name = string(abi.encodePacked(temp2.name(),' zero coupon bond'));
		symbol = string(abi.encodePacked(temp2.symbol(), 'zcb'));
		maturity = _maturity;
	}

	function minimumATokensAtMaturity(address _owner) public view returns (uint balance) {
		if (inPayoutPhase)
			balance = balanceYield[_owner]*maturityConversionRate/1e18;
		else
			balance = aw.WrappedTokenToAToken(balanceYield[_owner]);
		int bondBal = balanceBonds[_owner];
		if (bondBal > 0)
			balance = balance.add(uint(bondBal));
		else
			balance = balance.sub(uint(-bondBal));
	}

	function wrappedTokenFree(address _owner) public view returns (uint wrappedTknFree) {
		wrappedTknFree = balanceYield[_owner];
		int bondBal = balanceBonds[_owner];
		if (bondBal < 0){
			if (inPayoutPhase){
				uint toSub = uint(-bondBal).mul(1e18);
				toSub = toSub/maturityConversionRate + (toSub%maturityConversionRate  == 0 ? 0 : 1);
				wrappedTknFree = wrappedTknFree.sub(toSub);
			}
			else
				wrappedTknFree = wrappedTknFree.sub(aw.ATokenToWrappedToken(uint(-bondBal)));
		}
	}

	function depositWrappedToken(address _to, uint _amountWrappedTkn) public {
		aw.transferFrom(msg.sender, address(this), _amountWrappedTkn);
		balanceYield[_to] += _amountWrappedTkn;
	}

	function withdraw(address _to, uint _amountWrappedTkn, bool _unwrap) public {
		require(wrappedTokenFree(msg.sender) >= _amountWrappedTkn);
		balanceYield[msg.sender] -= _amountWrappedTkn;
		if (_unwrap)
			aw.withdrawWrappedToken(_to, _amountWrappedTkn);
		else
			aw.transfer(_to, _amountWrappedTkn);
	}

	function withdrawAll(address _to, bool _unwrap) public {
		uint freeToMove = wrappedTokenFree(msg.sender);
		balanceYield[msg.sender] -= freeToMove;
		if (_unwrap)
			aw.withdrawWrappedToken(_to, freeToMove);
		else
			aw.transfer(_to, freeToMove);
	}

	function claimBondPayout(address _to) public {
		int bondBal = balanceBonds[msg.sender];
		require(block.timestamp >= maturity && bondBal > 0);
		aw.withdrawWrappedToken(_to, uint(bondBal)*1e18/maturityConversionRate);
		balanceBonds[msg.sender] = 0;
	}

	function enterPayoutPhase() public {
		require(!inPayoutPhase && block.timestamp >= maturity);
		inPayoutPhase = true;
		maturityConversionRate = aw.WrappedTokenToAToken(1e18);
	}

//-------------ERC20 Implementation----------------


	function balanceOf(address _owner) public view override returns (uint balance) {
		int bondBal = balanceBonds[_owner];
		return uint(bondBal > 0 ? bondBal : 0);
	}


    function transfer(address _to, uint256 _value) public override returns (bool success) {
        require(_value <= minimumATokensAtMaturity(msg.sender));

        balanceBonds[msg.sender] -= int(_value);
        balanceBonds[_to] += int(_value);

        emit Transfer(msg.sender, _to, _value);

        return true;
    }

    function approve(address _spender, uint256 _value) public override returns (bool success) {
        allowance[msg.sender][_spender] = _value;

        emit Approval(msg.sender, _spender, _value);

        return true;
    }

    function transferFrom(address _from, address _to, uint256 _value) public override returns (bool success) {
        require(_value <= allowance[_from][msg.sender]);
    	require(_value <= minimumATokensAtMaturity(_from));

    	balanceBonds[_from] -= int(_value);
    	balanceBonds[_to] += int(_value);

        allowance[_from][msg.sender] -= _value;

        emit Transfer(_from, _to, _value);

        return true;
    }

    function totalSupply() public view override returns (uint _supply) {
    	_supply = aw.WrappedTokenToAToken(aw.balanceOf(address(this)));
    }
}