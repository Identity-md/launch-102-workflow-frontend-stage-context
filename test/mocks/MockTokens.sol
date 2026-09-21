// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @dev Minimal ERC-20 used as a base for hostile tokens in tests.
contract BaseMockToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mintForTest(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function _move(address from, address to, uint256 amount) internal {
        require(balanceOf[from] >= amount, "balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }

    function _spend(address from, uint256 amount) internal {
        require(allowance[from][msg.sender] >= amount, "allowance");
        allowance[from][msg.sender] -= amount;
    }
}

/// @dev Returns false instead of reverting.
contract FalseReturningToken is BaseMockToken {
    function transfer(address, uint256) external pure returns (bool) {
        return false;
    }

    function transferFrom(address, address, uint256) external pure returns (bool) {
        return false;
    }
}

/// @dev Returns nothing, like old USDT. Should be accepted.
contract NoReturnToken is BaseMockToken {
    function transfer(address to, uint256 amount) external {
        _move(msg.sender, to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) external {
        _spend(from, amount);
        _move(from, to, amount);
    }
}

/// @dev Calls back into a target during transfers and records whether the reentrant call succeeded.
contract ReentrantToken is BaseMockToken {
    address public target;
    bytes public payload;
    bool public attempted;
    bool public reentrySucceeded;
    bytes public reentryError;

    function arm(address target_, bytes calldata payload_) external {
        target = target_;
        payload = payload_;
        attempted = false;
    }

    function _hook() internal {
        if (target != address(0) && !attempted) {
            attempted = true;
            (bool ok, bytes memory err) = target.call(payload);
            reentrySucceeded = ok;
            reentryError = err;
        }
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _move(msg.sender, to, amount);
        _hook();
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        _spend(from, amount);
        _move(from, to, amount);
        _hook();
        return true;
    }
}
