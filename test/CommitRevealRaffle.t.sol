// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {RaffleToken} from "../src/RaffleToken.sol";
import {CommitRevealRaffle} from "../src/CommitRevealRaffle.sol";
import {FalseReturningToken, NoReturnToken, ReentrantToken} from "./mocks/MockTokens.sol";

contract CommitRevealRaffleTest is Test {
    event RoundStarted(uint256 indexed roundId, uint64 salesEnd, uint64 revealEnd);
    event TicketPurchased(
        uint256 indexed roundId, uint256 indexed ticketIndex, address indexed buyer, bytes32 commitment
    );
    event SecretRevealed(uint256 indexed roundId, uint256 indexed ticketIndex, address indexed buyer, bytes32 secret);
    event RoundSettled(uint256 indexed roundId, address indexed winner, uint256 winningTicket, uint256 pot);
    event PotRolledOver(uint256 indexed fromRoundId, uint256 indexed toRoundId, uint256 amount);
    event PrizeClaimed(uint256 indexed roundId, address indexed winner, uint256 amount);

    RaffleToken token;
    CommitRevealRaffle raffle;

    uint256 PRICE;
    uint256 SALES;
    uint256 REVEAL;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    address mallory = makeAddr("mallory");

    function setUp() public {
        vm.warp(1_700_000_000);
        token = new RaffleToken();
        raffle = new CommitRevealRaffle(address(token));
        PRICE = raffle.TICKET_PRICE();
        SALES = raffle.SALES_DURATION();
        REVEAL = raffle.REVEAL_DURATION();
        address[4] memory users = [alice, bob, carol, mallory];
        for (uint256 i; i < users.length; ++i) {
            token.transfer(users[i], 10_000e18);
            vm.prank(users[i]);
            token.approve(address(raffle), type(uint256).max);
        }
    }

    // ---------------------------------------------------------------- helpers

    function _c(bytes32 secret) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(secret));
    }

    function _buy(address who, bytes32 secret) internal returns (uint256 idx) {
        vm.prank(who);
        (, idx) = raffle.buyTicket(_c(secret));
    }

    function _reveal(address who, uint256 roundId, uint256 idx, bytes32 secret) internal {
        vm.prank(who);
        raffle.reveal(roundId, idx, secret);
    }

    function _toReveal(uint256 roundId) internal {
        vm.warp(raffle.getRound(roundId).salesEnd);
    }

    function _toSettle(uint256 roundId) internal {
        vm.warp(raffle.getRound(roundId).revealEnd);
    }

    /// @dev Independent reimplementation of the winner rule.
    function _expectedWinner(uint256 roundId, bytes32 entropy) internal view returns (uint256 idx) {
        uint256 sold = raffle.getRound(roundId).ticketsSold;
        idx = uint256(entropy) % sold;
        for (uint256 n; n < sold; ++n) {
            if (raffle.getTicket(roundId, idx).revealed) return idx;
            idx = (idx + 1) % sold;
        }
        revert("no revealed ticket");
    }

    // ---------------------------------------------------------------- constructor

    function test_constructorStoresToken() public view {
        assertEq(raffle.token(), address(token));
        assertEq(raffle.currentRoundId(), 1);
        assertEq(uint256(raffle.phase(1)), uint256(CommitRevealRaffle.Phase.NotStarted));
    }

    function test_constructorRejectsNonContractToken() public {
        vm.expectRevert(CommitRevealRaffle.InvalidToken.selector);
        new CommitRevealRaffle(address(0));
        vm.expectRevert(CommitRevealRaffle.InvalidToken.selector);
        new CommitRevealRaffle(alice);
    }

    // ---------------------------------------------------------------- buying

    function test_firstPurchaseStartsRound() public {
        bytes32 c = _c("a");
        vm.expectEmit(true, false, false, true);
        emit RoundStarted(1, uint64(block.timestamp + SALES), uint64(block.timestamp + SALES + REVEAL));
        vm.expectEmit(true, true, true, true);
        emit TicketPurchased(1, 0, alice, c);
        vm.prank(alice);
        (uint256 roundId, uint256 idx) = raffle.buyTicket(c);

        assertEq(roundId, 1);
        assertEq(idx, 0);
        CommitRevealRaffle.Round memory r = raffle.getRound(1);
        assertEq(r.ticketsSold, 1);
        assertEq(r.pot, PRICE);
        assertEq(r.salesEnd, block.timestamp + SALES);
        assertEq(r.revealEnd, block.timestamp + SALES + REVEAL);
        assertEq(token.balanceOf(address(raffle)), PRICE);
        assertEq(token.balanceOf(alice), 10_000e18 - PRICE);
        assertTrue(raffle.commitmentUsed(1, c));
        CommitRevealRaffle.Ticket memory t = raffle.getTicket(1, 0);
        assertEq(t.buyer, alice);
        assertEq(t.commitment, c);
        assertFalse(t.revealed);
        assertEq(uint256(raffle.phase(1)), uint256(CommitRevealRaffle.Phase.Sales));
    }

    function test_multipleTicketsPerBuyerTracked() public {
        _buy(alice, "a1");
        _buy(bob, "b1");
        _buy(alice, "a2");
        uint256[] memory mine = raffle.ticketsOf(1, alice);
        assertEq(mine.length, 2);
        assertEq(mine[0], 0);
        assertEq(mine[1], 2);
        assertEq(raffle.ticketsOf(1, bob).length, 1);
        assertEq(raffle.getRound(1).pot, 3 * PRICE);
    }

    function test_buyZeroCommitmentReverts() public {
        vm.prank(alice);
        vm.expectRevert(CommitRevealRaffle.ZeroCommitment.selector);
        raffle.buyTicket(bytes32(0));
    }

    function test_buyDuplicateCommitmentReverts() public {
        _buy(alice, "same");
        vm.prank(mallory);
        vm.expectRevert(CommitRevealRaffle.CommitmentAlreadyUsed.selector);
        raffle.buyTicket(_c("same"));
    }

    function test_buyWithoutAllowanceReverts() public {
        vm.prank(alice);
        token.approve(address(raffle), PRICE - 1);
        vm.prank(alice);
        vm.expectRevert(CommitRevealRaffle.TokenTransferFailed.selector);
        raffle.buyTicket(_c("a"));
        assertEq(raffle.getRound(1).ticketsSold, 0);
        assertEq(token.balanceOf(address(raffle)), 0);
    }

    function test_buyWithInsufficientBalanceReverts() public {
        address poor = makeAddr("poor");
        token.transfer(poor, PRICE - 1);
        vm.startPrank(poor);
        token.approve(address(raffle), type(uint256).max);
        vm.expectRevert(CommitRevealRaffle.TokenTransferFailed.selector);
        raffle.buyTicket(_c("p"));
        vm.stopPrank();
        assertEq(token.balanceOf(poor), PRICE - 1);
    }

    function test_buyRejectsEther() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (bool ok,) = address(raffle).call{value: 1}(abi.encodeCall(raffle.buyTicket, (_c("a"))));
        assertFalse(ok);
        (ok,) = address(raffle).call{value: 1}("");
        assertFalse(ok);
        assertEq(address(raffle).balance, 0);
    }

    function test_buyTimingBoundary() public {
        _buy(alice, "a");
        uint64 salesEnd = raffle.getRound(1).salesEnd;
        vm.warp(salesEnd - 1);
        _buy(bob, "b");
        vm.warp(salesEnd);
        vm.prank(carol);
        vm.expectRevert(CommitRevealRaffle.SalesClosed.selector);
        raffle.buyTicket(_c("c"));
        // Still closed until settlement opens the next round.
        vm.warp(salesEnd + REVEAL + 100);
        vm.prank(carol);
        vm.expectRevert(CommitRevealRaffle.SalesClosed.selector);
        raffle.buyTicket(_c("c"));
    }

    function test_roundFull() public {
        uint256 max = raffle.MAX_TICKETS_PER_ROUND();
        token.approve(address(raffle), type(uint256).max);
        for (uint256 i; i < max; ++i) {
            raffle.buyTicket(_c(bytes32(i + 1)));
        }
        vm.expectRevert(CommitRevealRaffle.RoundFull.selector);
        raffle.buyTicket(_c(bytes32(max + 1)));
    }

    /// @dev Worst case for the forward walk: a full round where only ticket 0 revealed.
    function test_settleGasBoundedForFullRound() public {
        uint256 max = raffle.MAX_TICKETS_PER_ROUND();
        token.approve(address(raffle), type(uint256).max);
        bytes32 s0;
        for (uint256 i = 1;; ++i) {
            s0 = bytes32(i);
            if (uint256(keccak256(abi.encodePacked(s0))) % max == 1) break; // walk 499 steps
        }
        raffle.buyTicket(_c(s0));
        for (uint256 i = 1; i < max; ++i) {
            raffle.buyTicket(_c(keccak256(abi.encode("filler", i))));
        }
        _toReveal(1);
        raffle.reveal(1, 0, s0);
        _toSettle(1);
        uint256 g = gasleft();
        raffle.settle(1);
        uint256 used = g - gasleft();
        assertEq(raffle.getRound(1).winner, address(this));
        assertLt(used, 3_000_000, "settlement must fit comfortably in a block");
    }

    // ---------------------------------------------------------------- revealing

    function test_revealHappyPath() public {
        uint256 idx = _buy(alice, "a");
        _toReveal(1);
        assertEq(uint256(raffle.phase(1)), uint256(CommitRevealRaffle.Phase.Reveal));
        vm.expectEmit(true, true, true, true);
        emit SecretRevealed(1, idx, alice, "a");
        _reveal(alice, 1, idx, "a");
        CommitRevealRaffle.Round memory r = raffle.getRound(1);
        assertEq(r.revealedCount, 1);
        assertEq(r.entropy, bytes32(0)); // set at settlement
        assertTrue(raffle.getTicket(1, idx).revealed);
    }

    function test_revealTimingBoundaries() public {
        uint256 idx = _buy(alice, "a");
        uint256 idx2 = _buy(bob, "b");
        CommitRevealRaffle.Round memory r = raffle.getRound(1);

        vm.warp(r.salesEnd - 1);
        vm.prank(alice);
        vm.expectRevert(CommitRevealRaffle.NotRevealPhase.selector);
        raffle.reveal(1, idx, "a");

        vm.warp(r.salesEnd);
        _reveal(alice, 1, idx, "a");

        vm.warp(r.revealEnd - 1);
        _reveal(bob, 1, idx2, "b");

        uint256 idx3;
        // new round cannot be bought until settle, so check late reveal with a fresh round
        vm.warp(r.revealEnd);
        raffle.settle(1);
        idx3 = _buy(carol, "c");
        CommitRevealRaffle.Round memory r2 = raffle.getRound(2);
        vm.warp(r2.revealEnd);
        vm.prank(carol);
        vm.expectRevert(CommitRevealRaffle.NotRevealPhase.selector);
        raffle.reveal(2, idx3, "c");
    }

    function test_revealByNonOwnerReverts() public {
        uint256 idx = _buy(alice, "a");
        _toReveal(1);
        vm.prank(mallory);
        vm.expectRevert(CommitRevealRaffle.NotTicketOwner.selector);
        raffle.reveal(1, idx, "a");
    }

    function test_revealWrongSecretReverts() public {
        uint256 idx = _buy(alice, "a");
        _toReveal(1);
        vm.prank(alice);
        vm.expectRevert(CommitRevealRaffle.CommitmentMismatch.selector);
        raffle.reveal(1, idx, "not-a");
    }

    function test_revealTwiceReverts() public {
        uint256 idx = _buy(alice, "a");
        _toReveal(1);
        _reveal(alice, 1, idx, "a");
        vm.prank(alice);
        vm.expectRevert(CommitRevealRaffle.AlreadyRevealed.selector);
        raffle.reveal(1, idx, "a");
    }

    function test_revealUnknownRoundOrTicketReverts() public {
        _buy(alice, "a");
        _toReveal(1);
        vm.prank(alice);
        vm.expectRevert(CommitRevealRaffle.UnknownRound.selector);
        raffle.reveal(7, 0, "a");
        vm.prank(alice);
        vm.expectRevert(CommitRevealRaffle.UnknownTicket.selector);
        raffle.reveal(1, 1, "a");
    }

    // ---------------------------------------------------------------- settlement

    function test_settleBoundaries() public {
        vm.expectRevert(CommitRevealRaffle.UnknownRound.selector);
        raffle.settle(1);

        uint256 idx = _buy(alice, "a");
        _toReveal(1);
        _reveal(alice, 1, idx, "a");
        uint64 revealEnd = raffle.getRound(1).revealEnd;
        vm.warp(revealEnd - 1);
        vm.expectRevert(CommitRevealRaffle.RevealNotFinished.selector);
        raffle.settle(1);

        vm.warp(revealEnd);
        assertEq(uint256(raffle.phase(1)), uint256(CommitRevealRaffle.Phase.AwaitingSettlement));
        vm.prank(mallory); // anyone may settle
        raffle.settle(1);
        assertEq(uint256(raffle.phase(1)), uint256(CommitRevealRaffle.Phase.Settled));
        assertEq(raffle.currentRoundId(), 2);

        vm.expectRevert(CommitRevealRaffle.AlreadySettled.selector);
        raffle.settle(1);
    }

    function test_winnerFollowsTheRule() public {
        uint256 a = _buy(alice, "alpha");
        uint256 b = _buy(bob, "bravo");
        uint256 c = _buy(carol, "charlie");
        _toReveal(1);
        _reveal(alice, 1, a, "alpha");
        _reveal(bob, 1, b, "bravo");
        _reveal(carol, 1, c, "charlie");
        bytes32 entropy = keccak256(abi.encodePacked(bytes32("alpha"), bytes32("bravo"), bytes32("charlie")));
        _toSettle(1);

        uint256 expected = uint256(entropy) % 3;
        address expectedWinner = raffle.getTicket(1, expected).buyer;
        vm.expectEmit(true, true, false, true);
        emit RoundSettled(1, expectedWinner, expected, 3 * PRICE);
        raffle.settle(1);

        CommitRevealRaffle.Round memory r = raffle.getRound(1);
        assertEq(r.winner, expectedWinner);
        assertEq(r.winningTicket, expected);
    }

    function test_revealOrderDoesNotMatter() public {
        uint256 a = _buy(alice, "alpha");
        uint256 b = _buy(bob, "bravo");
        _toReveal(1);
        _reveal(bob, 1, b, "bravo");
        _reveal(alice, 1, a, "alpha");
        _toSettle(1);
        raffle.settle(1);
        assertEq(raffle.getRound(1).entropy, keccak256(abi.encodePacked(bytes32("alpha"), bytes32("bravo"))));
    }

    /// @dev Reviewer scenario: secrets 1 and 2 hash (in ticket order) to an even index -> Alice, not XOR's Bob.
    function test_winnerIsKeccakOfAllSecretsNotXor() public {
        uint256 a = _buy(alice, bytes32(uint256(1)));
        uint256 b = _buy(bob, bytes32(uint256(2)));
        _toReveal(1);
        _reveal(bob, 1, b, bytes32(uint256(2)));
        _reveal(alice, 1, a, bytes32(uint256(1)));
        _toSettle(1);
        raffle.settle(1);
        assertEq(raffle.getRound(1).winner, alice);
    }

    /// @dev Searches for secrets whose raw index lands on a non-revealer, and checks forfeiture.
    function test_nonRevealerForfeitsEvenWhenIndexLandsOnThem() public {
        // Tickets: 0 alice (reveals), 1 mallory (does not), 2 bob (reveals).
        bytes32 sa;
        bytes32 sb = "bob";
        for (uint256 i = 1;; ++i) {
            sa = bytes32(i);
            if (uint256(keccak256(abi.encodePacked(sa, sb))) % 3 == 1) break;
        }
        uint256 a = _buy(alice, sa);
        _buy(mallory, "mallory");
        uint256 b = _buy(bob, sb);
        _toReveal(1);
        _reveal(alice, 1, a, sa);
        _reveal(bob, 1, b, sb);
        _toSettle(1);
        raffle.settle(1);
        CommitRevealRaffle.Round memory r = raffle.getRound(1);
        assertEq(r.winningTicket, 2, "moves forward to next revealed ticket");
        assertEq(r.winner, bob);

        vm.prank(mallory);
        vm.expectRevert(CommitRevealRaffle.NotWinner.selector);
        raffle.claim(1);
    }

    function test_winnerIndexWrapsAround() public {
        // Tickets: 0 alice (reveals), 1 mallory, 2 carol (do not). Index 1 or 2 must wrap to 0.
        bytes32 sa;
        for (uint256 i = 1;; ++i) {
            sa = bytes32(i);
            if (uint256(keccak256(abi.encodePacked(sa))) % 3 == 2) break;
        }
        uint256 a = _buy(alice, sa);
        _buy(mallory, "m");
        _buy(carol, "c");
        _toReveal(1);
        _reveal(alice, 1, a, sa);
        _toSettle(1);
        raffle.settle(1);
        assertEq(raffle.getRound(1).winningTicket, 0);
        assertEq(raffle.getRound(1).winner, alice);
    }

    function test_noRevealsRollsPotOver() public {
        _buy(alice, "a");
        _buy(bob, "b");
        _toSettle(1);
        vm.expectEmit(true, true, false, true);
        emit PotRolledOver(1, 2, 2 * PRICE);
        raffle.settle(1);

        CommitRevealRaffle.Round memory r1 = raffle.getRound(1);
        assertEq(r1.winner, address(0));
        assertEq(r1.pot, 0);
        assertEq(raffle.getRound(2).pot, 2 * PRICE);
        vm.prank(alice);
        vm.expectRevert(CommitRevealRaffle.NoWinner.selector);
        raffle.claim(1);

        // Round 2: carol is the only revealer and takes both pots.
        uint256 c = _buy(carol, "c");
        assertEq(raffle.getRound(2).pot, 3 * PRICE);
        _toReveal(2);
        _reveal(carol, 2, c, "c");
        _toSettle(2);
        raffle.settle(2);
        uint256 before = token.balanceOf(carol);
        vm.prank(carol);
        raffle.claim(2);
        assertEq(token.balanceOf(carol), before + 3 * PRICE);
        assertEq(token.balanceOf(address(raffle)), 0);
    }

    function test_sameCommitmentAllowedInLaterRound() public {
        uint256 a = _buy(alice, "a");
        _toReveal(1);
        _reveal(alice, 1, a, "a");
        _toSettle(1);
        raffle.settle(1);
        vm.prank(alice);
        (uint256 roundId,) = raffle.buyTicket(_c("a"));
        assertEq(roundId, 2);
    }

    // ---------------------------------------------------------------- claiming

    function _singleWinnerRound() internal returns (address winner) {
        uint256 a = _buy(alice, "a");
        uint256 b = _buy(bob, "b");
        _toReveal(1);
        _reveal(alice, 1, a, "a");
        _reveal(bob, 1, b, "b");
        _toSettle(1);
        raffle.settle(1);
        winner = raffle.getRound(1).winner;
    }

    function test_claimPaysPot() public {
        address winner = _singleWinnerRound();
        uint256 before = token.balanceOf(winner);
        vm.expectEmit(true, true, false, true);
        emit PrizeClaimed(1, winner, 2 * PRICE);
        vm.prank(winner);
        raffle.claim(1);
        assertEq(token.balanceOf(winner), before + 2 * PRICE);
        assertEq(token.balanceOf(address(raffle)), 0);
        assertTrue(raffle.getRound(1).claimed);
    }

    function test_claimBeforeSettleReverts() public {
        _buy(alice, "a");
        vm.prank(alice);
        vm.expectRevert(CommitRevealRaffle.NotSettled.selector);
        raffle.claim(1);
    }

    function test_claimByNonWinnerReverts() public {
        address winner = _singleWinnerRound();
        address loser = winner == alice ? bob : alice;
        vm.prank(loser);
        vm.expectRevert(CommitRevealRaffle.NotWinner.selector);
        raffle.claim(1);
        vm.prank(mallory);
        vm.expectRevert(CommitRevealRaffle.NotWinner.selector);
        raffle.claim(1);
    }

    function test_doubleClaimReverts() public {
        address winner = _singleWinnerRound();
        vm.prank(winner);
        raffle.claim(1);
        vm.prank(winner);
        vm.expectRevert(CommitRevealRaffle.AlreadyClaimed.selector);
        raffle.claim(1);
    }

    function test_claimAfterLaterRoundsStillWorks() public {
        address winner = _singleWinnerRound();
        uint256 c = _buy(carol, "c");
        _toReveal(2);
        _reveal(carol, 2, c, "c");
        _toSettle(2);
        raffle.settle(2);
        uint256 before = token.balanceOf(winner);
        vm.prank(winner);
        raffle.claim(1);
        assertEq(token.balanceOf(winner), before + 2 * PRICE);
        assertEq(token.balanceOf(address(raffle)), PRICE);
    }

    // ---------------------------------------------------------------- conservation (fuzz)

    function testFuzz_conservation(uint8 nTickets, uint256 revealMask, uint256 salt) public {
        nTickets = uint8(bound(nTickets, 1, 20));
        address[4] memory users = [alice, bob, carol, mallory];
        uint256 supplyHeld =
            token.balanceOf(alice) + token.balanceOf(bob) + token.balanceOf(carol) + token.balanceOf(mallory);

        bytes32[] memory secrets = new bytes32[](nTickets);
        for (uint256 i; i < nTickets; ++i) {
            secrets[i] = keccak256(abi.encode(salt, i));
            _buy(users[i % 4], secrets[i]);
        }
        assertEq(token.balanceOf(address(raffle)), uint256(nTickets) * PRICE);

        _toReveal(1);
        bytes memory packed;
        for (uint256 i; i < nTickets; ++i) {
            if ((revealMask >> i) & 1 == 1) {
                _reveal(users[i % 4], 1, i, secrets[i]);
                packed = abi.encodePacked(packed, secrets[i]);
            }
        }
        _toSettle(1);
        raffle.settle(1);
        CommitRevealRaffle.Round memory r = raffle.getRound(1);

        if (r.revealedCount == 0) {
            assertEq(r.winner, address(0));
            assertEq(raffle.getRound(2).pot, uint256(nTickets) * PRICE);
        } else {
            uint256 expected = _expectedWinner(1, keccak256(packed));
            assertEq(r.winningTicket, expected);
            assertTrue(raffle.getTicket(1, r.winningTicket).revealed);
            vm.prank(r.winner);
            raffle.claim(1);
            assertEq(token.balanceOf(address(raffle)), 0);
        }
        uint256 supplyAfter = token.balanceOf(alice) + token.balanceOf(bob) + token.balanceOf(carol)
            + token.balanceOf(mallory) + token.balanceOf(address(raffle));
        assertEq(supplyAfter, supplyHeld);
    }

    // ---------------------------------------------------------------- hostile tokens

    function test_falseReturningTokenReverts() public {
        FalseReturningToken bad = new FalseReturningToken();
        CommitRevealRaffle r = new CommitRevealRaffle(address(bad));
        vm.prank(alice);
        vm.expectRevert(CommitRevealRaffle.TokenTransferFailed.selector);
        r.buyTicket(_c("a"));
    }

    function test_noReturnTokenAccepted() public {
        NoReturnToken nr = new NoReturnToken();
        CommitRevealRaffle r = new CommitRevealRaffle(address(nr));
        nr.mintForTest(alice, PRICE);
        vm.startPrank(alice);
        nr.approve(address(r), PRICE);
        r.buyTicket(_c("a"));
        vm.warp(r.getRound(1).salesEnd);
        r.reveal(1, 0, "a");
        vm.warp(r.getRound(1).revealEnd);
        r.settle(1);
        r.claim(1);
        vm.stopPrank();
        assertEq(nr.balanceOf(alice), PRICE);
    }

    function test_reentrancyDuringBuyIsBlocked() public {
        ReentrantToken evil = new ReentrantToken();
        CommitRevealRaffle r = new CommitRevealRaffle(address(evil));
        evil.mintForTest(alice, 10 * PRICE);
        vm.prank(alice);
        evil.approve(address(r), type(uint256).max);

        evil.arm(address(r), abi.encodeCall(r.buyTicket, (_c("reenter"))));
        vm.prank(alice);
        r.buyTicket(_c("a"));

        assertTrue(evil.attempted());
        assertFalse(evil.reentrySucceeded());
        assertEq(bytes4(evil.reentryError()), CommitRevealRaffle.Reentrancy.selector);
        assertEq(r.getRound(1).ticketsSold, 1);
        assertFalse(r.commitmentUsed(1, _c("reenter")));
        assertEq(evil.balanceOf(address(r)), PRICE);
    }

    function test_reentrancyDuringClaimIsBlocked() public {
        ReentrantToken evil = new ReentrantToken();
        CommitRevealRaffle r = new CommitRevealRaffle(address(evil));
        evil.mintForTest(alice, 10 * PRICE);
        vm.startPrank(alice);
        evil.approve(address(r), type(uint256).max);
        r.buyTicket(_c("a"));
        vm.warp(r.getRound(1).salesEnd);
        r.reveal(1, 0, "a");
        vm.warp(r.getRound(1).revealEnd);
        r.settle(1);
        vm.stopPrank();

        // The token tries to claim again mid-transfer.
        evil.arm(address(r), abi.encodeCall(r.claim, (1)));
        vm.prank(alice);
        r.claim(1);

        assertTrue(evil.attempted());
        assertFalse(evil.reentrySucceeded());
        assertEq(bytes4(evil.reentryError()), CommitRevealRaffle.Reentrancy.selector);
        assertEq(evil.balanceOf(alice), 10 * PRICE);
        assertEq(evil.balanceOf(address(r)), 0);
    }

    function test_reentrancyIntoSettleAndRevealIsBlocked() public {
        ReentrantToken evil = new ReentrantToken();
        CommitRevealRaffle r = new CommitRevealRaffle(address(evil));
        evil.mintForTest(alice, 10 * PRICE);
        vm.prank(alice);
        evil.approve(address(r), type(uint256).max);

        evil.arm(address(r), abi.encodeCall(r.settle, (1)));
        vm.prank(alice);
        r.buyTicket(_c("a"));
        assertEq(bytes4(evil.reentryError()), CommitRevealRaffle.Reentrancy.selector);

        evil.arm(address(r), abi.encodeCall(r.reveal, (1, 0, bytes32("a"))));
        vm.prank(alice);
        r.buyTicket(_c("b"));
        assertEq(bytes4(evil.reentryError()), CommitRevealRaffle.Reentrancy.selector);
        assertFalse(r.getRound(1).settled);
    }

    function test_commitmentForHelper() public view {
        assertEq(raffle.commitmentFor("x"), keccak256(abi.encodePacked(bytes32("x"))));
    }
}
