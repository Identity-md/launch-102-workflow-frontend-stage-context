// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {RaffleToken} from "../src/RaffleToken.sol";

contract RaffleTokenTest is Test {
    event Transfer(address indexed from, address indexed to, uint256 value);

    RaffleToken token;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        token = new RaffleToken();
    }

    function test_metadataAndSupply() public view {
        assertEq(token.name(), "Raffle");
        assertEq(token.symbol(), "RAFL");
        assertEq(token.decimals(), 18);
        assertEq(token.totalSupply(), 1e27);
        assertEq(token.balanceOf(address(this)), 1e27);
    }

    function test_constructorEmitsMintToDeployer() public {
        vm.expectEmit(true, true, false, true);
        emit Transfer(address(0), alice, 1e27);
        vm.prank(alice);
        RaffleToken t = new RaffleToken();
        assertEq(t.balanceOf(alice), 1e27);
    }

    function test_transfer() public {
        assertTrue(token.transfer(alice, 5e18));
        assertEq(token.balanceOf(alice), 5e18);
        assertEq(token.balanceOf(address(this)), 1e27 - 5e18);
    }

    function test_transferInsufficientBalanceReverts() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(RaffleToken.InsufficientBalance.selector, alice, 0, 1));
        token.transfer(bob, 1);
    }

    function test_transferToZeroReverts() public {
        vm.expectRevert(abi.encodeWithSelector(RaffleToken.InvalidReceiver.selector, address(0)));
        token.transfer(address(0), 1);
    }

    function test_approveAndTransferFrom() public {
        token.approve(alice, 10e18);
        vm.prank(alice);
        token.transferFrom(address(this), bob, 4e18);
        assertEq(token.balanceOf(bob), 4e18);
        assertEq(token.allowance(address(this), alice), 6e18);
    }

    function test_transferFromInsufficientAllowanceReverts() public {
        token.approve(alice, 1);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(RaffleToken.InsufficientAllowance.selector, alice, 1, 2));
        token.transferFrom(address(this), bob, 2);
    }

    function test_infiniteAllowanceIsNotDecremented() public {
        token.approve(alice, type(uint256).max);
        vm.prank(alice);
        token.transferFrom(address(this), bob, 1e18);
        assertEq(token.allowance(address(this), alice), type(uint256).max);
    }

    function test_noMintPath() public {
        (bool ok,) = address(token).call(abi.encodeWithSignature("mint(address,uint256)", address(this), 1));
        assertFalse(ok);
        assertEq(token.totalSupply(), 1e27);
    }

    function testFuzz_transferConservesSupply(uint256 amount) public {
        amount = bound(amount, 0, 1e27);
        token.transfer(alice, amount);
        assertEq(token.balanceOf(alice) + token.balanceOf(address(this)), 1e27);
    }
}
