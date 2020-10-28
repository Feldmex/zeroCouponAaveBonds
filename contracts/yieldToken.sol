pragma solidity >=0.6.5 <0.7.0;
import "./interfaces/IERC20.sol";
import "./libraries/SafeMath.sol";
import "./capitalHandler.sol";
import "./aaveWrapper.sol";

contract yieldToken is IERC20 {

	capitalHandler public ch;
	aaveWrapper aw;

    string public override name;
    string public override symbol;
	uint8 public override decimals;

    mapping(address => mapping(address => uint256)) public override allowance;

	constructor(address _aToken, address _capitalHandler) public {
		aaveWrapper _aTkn = aaveWrapper(_aToken);
		decimals = _aTkn.decimals();
		symbol = string(abi.encodePacked(_aTkn.symbol(),'yt'));
		name = string(abi.encodePacked(_aTkn.name(),'yield token'));
		aw = _aTkn;
		ch = capitalHandler(_capitalHandler);
	}

	function totalSupply() public view override returns (uint _supply){
		_supply = aw.balanceOf(address(ch));
	}

    function balanceOf(address _owner) public view override returns (uint _amount) {
    	_amount = ch.balanceYield(_owner);
    }

    function transfer(address _to, uint256 _value) public override returns (bool success) {
        ch.transferYield(msg.sender, _to, _value);

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

        ch.transferYield(_from, _to, _value);

        allowance[_from][msg.sender] -= _value;

        emit Transfer(_from, _to, _value);

        return true;
    }

}