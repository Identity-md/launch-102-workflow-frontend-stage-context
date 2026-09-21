// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title CommitRevealRaffle
/// @notice A sequence of raffle rounds paid in a single ERC-20 (RAFL), with commit-reveal randomness.
///
/// Round lifecycle (all times are `block.timestamp`):
///  1. The first `buyTicket` of a round starts it: sales are open while `now < salesEnd`
///     (`salesEnd = start + SALES_DURATION`). Each ticket costs exactly `TICKET_PRICE` and carries
///     `commitment = keccak256(abi.encodePacked(secret))`. Commitments are unique within a round.
///  2. Reveal window: `salesEnd <= now < revealEnd` (`revealEnd = salesEnd + REVEAL_DURATION`). Only
///     the ticket's buyer may reveal it. Revealed secrets are XOR-accumulated (order independent).
///  3. From `revealEnd` anyone may `settle`. The winning index is
///     `uint256(keccak256(abi.encodePacked(xorOfRevealedSecrets))) % ticketsSold`; a ticket that was
///     not revealed forfeits eligibility, so the index moves forward (wrapping) to the next revealed
///     ticket. If nobody revealed, the whole pot rolls over into the next round.
///  4. The buyer of the winning ticket calls `claim` to receive the full pot. There is no deadline.
///
/// There is no owner, admin, fee, pause or upgrade path. The only external calls go to `token`.
/// @dev Commit-reveal is not unbiasable randomness: the last revealer(s) can see the outcome of
/// revealing versus withholding and may withhold (forfeiting that ticket). See README.
contract CommitRevealRaffle {
    enum Phase {
        NotStarted,
        Sales,
        Reveal,
        AwaitingSettlement,
        Settled
    }

    struct Round {
        uint64 salesEnd;
        uint64 revealEnd;
        uint32 ticketsSold;
        uint32 revealedCount;
        bool settled;
        bool claimed;
        address winner;
        uint32 winningTicket;
        uint256 pot;
        bytes32 entropy;
    }

    struct Ticket {
        address buyer;
        bool revealed;
        bytes32 commitment;
    }

    uint256 public constant TICKET_PRICE = 100 * 10 ** 18;
    uint256 public constant SALES_DURATION = 1 days;
    uint256 public constant REVEAL_DURATION = 1 days;
    uint256 public constant MAX_TICKETS_PER_ROUND = 500;

    address public immutable token;

    uint256 public currentRoundId = 1;

    mapping(uint256 roundId => Round) private _rounds;
    mapping(uint256 roundId => mapping(uint256 index => Ticket)) private _tickets;
    mapping(uint256 roundId => mapping(bytes32 commitment => bool)) public commitmentUsed;
    mapping(uint256 roundId => mapping(address buyer => uint256[])) private _ticketsOf;

    uint256 private _lock = 1;

    event RoundStarted(uint256 indexed roundId, uint64 salesEnd, uint64 revealEnd);
    event TicketPurchased(
        uint256 indexed roundId, uint256 indexed ticketIndex, address indexed buyer, bytes32 commitment
    );
    event SecretRevealed(uint256 indexed roundId, uint256 indexed ticketIndex, address indexed buyer, bytes32 secret);
    event RoundSettled(uint256 indexed roundId, address indexed winner, uint256 winningTicket, uint256 pot);
    event PotRolledOver(uint256 indexed fromRoundId, uint256 indexed toRoundId, uint256 amount);
    event PrizeClaimed(uint256 indexed roundId, address indexed winner, uint256 amount);

    error InvalidToken();
    error Reentrancy();
    error ZeroCommitment();
    error CommitmentAlreadyUsed();
    error SalesClosed();
    error RoundFull();
    error UnknownRound();
    error UnknownTicket();
    error NotRevealPhase();
    error NotTicketOwner();
    error AlreadyRevealed();
    error CommitmentMismatch();
    error RevealNotFinished();
    error AlreadySettled();
    error NotSettled();
    error NoWinner();
    error NotWinner();
    error AlreadyClaimed();
    error TokenTransferFailed();

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(address token_) {
        if (token_.code.length == 0) revert InvalidToken();
        token = token_;
    }

    // ---------------------------------------------------------------------------------------------
    // Actions
    // ---------------------------------------------------------------------------------------------

    /// @notice Buy one ticket in the current round for `TICKET_PRICE` RAFL (requires prior approval).
    /// @param commitment `keccak256(abi.encodePacked(secret))` for a 32-byte secret kept by the buyer.
    function buyTicket(bytes32 commitment) external nonReentrant returns (uint256 roundId, uint256 ticketIndex) {
        if (commitment == bytes32(0)) revert ZeroCommitment();
        roundId = currentRoundId;
        Round storage r = _rounds[roundId];

        if (r.salesEnd == 0) {
            uint64 salesEnd = uint64(block.timestamp + SALES_DURATION);
            uint64 revealEnd = uint64(block.timestamp + SALES_DURATION + REVEAL_DURATION);
            r.salesEnd = salesEnd;
            r.revealEnd = revealEnd;
            emit RoundStarted(roundId, salesEnd, revealEnd);
        } else if (block.timestamp >= r.salesEnd) {
            revert SalesClosed();
        }
        if (r.ticketsSold >= MAX_TICKETS_PER_ROUND) revert RoundFull();
        if (commitmentUsed[roundId][commitment]) revert CommitmentAlreadyUsed();

        ticketIndex = r.ticketsSold;
        r.ticketsSold = uint32(ticketIndex + 1);
        r.pot += TICKET_PRICE;
        commitmentUsed[roundId][commitment] = true;
        _tickets[roundId][ticketIndex] = Ticket({buyer: msg.sender, revealed: false, commitment: commitment});
        _ticketsOf[roundId][msg.sender].push(ticketIndex);
        emit TicketPurchased(roundId, ticketIndex, msg.sender, commitment);

        _callToken(abi.encodeWithSelector(0x23b872dd, msg.sender, address(this), TICKET_PRICE)); // transferFrom
    }

    /// @notice Reveal the secret behind one of your tickets during the reveal window.
    function reveal(uint256 roundId, uint256 ticketIndex, bytes32 secret) external nonReentrant {
        Round storage r = _rounds[roundId];
        if (r.salesEnd == 0) revert UnknownRound();
        if (ticketIndex >= r.ticketsSold) revert UnknownTicket();
        if (block.timestamp < r.salesEnd || block.timestamp >= r.revealEnd) revert NotRevealPhase();

        Ticket storage t = _tickets[roundId][ticketIndex];
        if (t.buyer != msg.sender) revert NotTicketOwner();
        if (t.revealed) revert AlreadyRevealed();
        if (keccak256(abi.encodePacked(secret)) != t.commitment) revert CommitmentMismatch();

        t.revealed = true;
        r.revealedCount += 1;
        r.entropy ^= secret;
        emit SecretRevealed(roundId, ticketIndex, msg.sender, secret);
    }

    /// @notice Settle a round after its reveal window. Callable by anyone. Opens the next round.
    function settle(uint256 roundId) external nonReentrant {
        Round storage r = _rounds[roundId];
        if (r.salesEnd == 0) revert UnknownRound();
        if (r.settled) revert AlreadySettled();
        if (block.timestamp < r.revealEnd) revert RevealNotFinished();

        // Only the current round can be started and unsettled: a new round opens only here.
        r.settled = true;
        uint256 nextRoundId = roundId + 1;
        currentRoundId = nextRoundId;

        if (r.revealedCount == 0) {
            uint256 amount = r.pot;
            r.pot = 0;
            _rounds[nextRoundId].pot += amount;
            emit RoundSettled(roundId, address(0), 0, 0);
            emit PotRolledOver(roundId, nextRoundId, amount);
            return;
        }

        uint256 sold = r.ticketsSold;
        uint256 index = uint256(keccak256(abi.encodePacked(r.entropy))) % sold;
        // Terminates: at least one ticket is revealed.
        while (!_tickets[roundId][index].revealed) {
            index = index + 1 == sold ? 0 : index + 1;
        }
        address winner = _tickets[roundId][index].buyer;
        r.winner = winner;
        r.winningTicket = uint32(index);
        emit RoundSettled(roundId, winner, index, r.pot);
    }

    /// @notice Winner of a settled round collects the pot.
    function claim(uint256 roundId) external nonReentrant {
        Round storage r = _rounds[roundId];
        if (!r.settled) revert NotSettled();
        if (r.winner == address(0)) revert NoWinner();
        if (msg.sender != r.winner) revert NotWinner();
        if (r.claimed) revert AlreadyClaimed();

        r.claimed = true;
        uint256 amount = r.pot;
        emit PrizeClaimed(roundId, msg.sender, amount);

        _callToken(abi.encodeWithSelector(0xa9059cbb, msg.sender, amount)); // transfer
    }

    // ---------------------------------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------------------------------

    function getRound(uint256 roundId) external view returns (Round memory) {
        return _rounds[roundId];
    }

    function getTicket(uint256 roundId, uint256 ticketIndex) external view returns (Ticket memory) {
        return _tickets[roundId][ticketIndex];
    }

    function ticketsOf(uint256 roundId, address buyer) external view returns (uint256[] memory) {
        return _ticketsOf[roundId][buyer];
    }

    function phase(uint256 roundId) external view returns (Phase) {
        Round storage r = _rounds[roundId];
        if (r.settled) return Phase.Settled;
        if (r.salesEnd == 0) return Phase.NotStarted;
        if (block.timestamp < r.salesEnd) return Phase.Sales;
        if (block.timestamp < r.revealEnd) return Phase.Reveal;
        return Phase.AwaitingSettlement;
    }

    /// @notice Helper for clients: the commitment for a secret.
    function commitmentFor(bytes32 secret) external pure returns (bytes32) {
        return keccak256(abi.encodePacked(secret));
    }

    // ---------------------------------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------------------------------

    /// @dev Calls the token and accepts either no return data or an ABI-encoded `true`.
    function _callToken(bytes memory data) private {
        (bool ok, bytes memory ret) = token.call(data);
        if (!ok || (ret.length != 0 && (ret.length < 32 || !abi.decode(ret, (bool))))) {
            revert TokenTransferFailed();
        }
    }
}
