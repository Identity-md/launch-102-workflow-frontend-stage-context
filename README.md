# Raffle — RAFL token and CommitRevealRaffle

Contracts for the Raffle Sepolia project launch (chain id 11155111): a fixed-supply launch token and one
commit-reveal raffle contract. This covers only the contracts stage: source, tests and ABI exports.
`launch.json`, reviews, deployment and the website belong to other assignments.

```
src/RaffleToken.sol            Raffle (RAFL), fixed-supply ERC-20
src/CommitRevealRaffle.sol     raffle rounds paid in RAFL, commit-reveal winner selection
test/                          Foundry tests (token, raffle, hostile-token mocks)
docs/abi/<Contract>.json       ABI exports (`forge inspect <Contract> abi --json`)
lib/forge-std                  vendored forge-std v1.9.7 (plain files, not a submodule)
```

Build and test fully offline (solc 0.8.26, `bytecode_hash = "none"`, no ffi, no fs permissions):

```
forge build --offline
forge test --offline
forge fmt --check
```

## RaffleToken (RAFL)

- Name `Raffle`, symbol `RAFL`, 18 decimals.
- Zero-argument constructor mints exactly 1,000,000,000 RAFL (10^27 minor units) to `msg.sender`
  (the ProjectFactory during launch).
- No owner, mint, burn, pause, fee, blacklist, proxy or upgrade path. `totalSupply` is immutable.
- Standard `transfer` / `approve` / `transferFrom`; an allowance of `type(uint256).max` is not
  decremented. Transfers to the zero address revert.

## CommitRevealRaffle

Constructor: `constructor(address token)` — the only argument, filled with `$token` in the manifest.
It reverts if the address has no code. It is nonpayable and makes no calls.

There is **no owner, admin, fee, pause, upgradeability or privileged beneficiary**. Its only external
calls go to `token` (`transferFrom` on purchase, `transfer` on claim). Every mutating function uses a
reentrancy lock and follows checks-effects-interactions. No function is payable, so ETH is rejected.

### Parameters (compile-time constants)

| constant                | value     |
|-------------------------|-----------|
| `TICKET_PRICE`          | 100 RAFL (100e18) |
| `SALES_DURATION`        | 1 day     |
| `REVEAL_DURATION`       | 1 day     |
| `MAX_TICKETS_PER_ROUND` | 500       |

### Round lifecycle

Rounds are numbered from 1. `currentRoundId` is the only round that accepts tickets.

1. **Start / sales.** The first `buyTicket(commitment)` of a round starts it: `salesEnd = now + 1 day`,
   `revealEnd = salesEnd + 1 day`. Sales are open while `block.timestamp < salesEnd`. Each call buys one
   ticket for exactly `TICKET_PRICE` (the buyer must approve the raffle beforehand). The buyer may hold
   several tickets, each with its own commitment.
   `commitment = keccak256(abi.encodePacked(secret))` for a 32-byte secret (`commitmentFor(secret)` is a
   view helper; clients should compute it locally rather than send the secret to an RPC).
   Commitments must be non-zero and unique within a round, which stops someone copying a commitment and
   later replaying its revealed secret.
2. **Reveal.** While `salesEnd <= block.timestamp < revealEnd`, the ticket's buyer (only that address)
   calls `reveal(roundId, ticketIndex, secret)`. Each revealed secret is stored per ticket.
3. **Settle.** From `block.timestamp >= revealEnd`, anyone calls `settle(roundId)`. That opens round
   `roundId + 1`.
   - Winning index: `uint256(entropy) % ticketsSold`, where `entropy` is the keccak256 of all revealed
     secrets concatenated in ticket order (stored in the round at settlement). A ticket that was not revealed is not eligible. If the index points
     to one, the index moves forward, wrapping to 0, until it reaches a revealed ticket.
   - If nobody revealed, there is no winner. The whole pot rolls into the next round's pot
     (`PotRolledOver`).
4. **Claim.** The buyer of the winning ticket calls `claim(roundId)` and receives the whole pot. There
   is no deadline, and prizes from older rounds stay claimable.

Events: `RoundStarted`, `TicketPurchased`, `SecretRevealed`, `RoundSettled`, `PotRolledOver`,
`PrizeClaimed`. Views: `getRound`, `getTicket`, `ticketsOf(roundId, buyer)`, `phase(roundId)`
(`NotStarted | Sales | Reveal | AwaitingSettlement | Settled`), `commitmentUsed`, `currentRoundId`.

### Funds and conservation

The raffle's RAFL balance always equals the sum of unclaimed winning pots, plus the pot of the current
round (which includes any rollover). Nothing can be withdrawn except by a winner through `claim`.
A buyer cannot get a refund. That is on purpose: refunds would let non-revealers leave for free.

### Assumptions and known limitations (for the independent review)

- **Commit-reveal is not unbiased randomness.** The last revealer(s) can compute the outcome with and
  without their reveal and choose to withhold, forfeiting that ticket. Holding k tickets gives up to
  2^k choices. Secrets are hashed in ticket order, so reveal order adds no further choices. Nobody
  can change a secret after committing. Tickets bought late do not help, because all commitments are
  fixed before any secret is public. This mechanism is what the approved design asks for. It is not
  VRF-grade randomness.
- **Forward-walk bias.** When a non-revealer is hit, the next revealed ticket gets its share. So a
  revealed ticket that follows a run of non-revealers wins more often.
- **No-reveal rollover.** If every buyer in a round withholds, the pot carries forward. If no one ever
  buys again, it stays in the contract.
- **Settlement gas.** In the worst case (500 tickets, one revealed ticket far from the index) the walk
  reads up to 499 cold ticket slots, roughly 1.1–1.3M gas. That is well inside the Sepolia block limit.
  `test_settleGasBoundedForFullRound` covers this, though with warm storage.
- **Timestamps** only set the phase boundaries. A validator can shift them by seconds, which only
  moves those boundaries. The randomness does not depend on block values.
- **Token.** The raffle is designed for RAFL, which is exact-transfer with no fee. It accepts ERC-20s
  that return `true` or return nothing, and rejects `false`. Fee-on-transfer or rebasing tokens are not
  supported.
- Tests passing is not an audit. The contracts need the independent adversarial review before release.

## Deployment parameters (for the manifest node — not written here)

- Token: `RaffleToken`, no constructor args, 18 decimals, supply 10^27 minted to the factory.
- Application contracts in dependency order: `CommitRevealRaffle` with `constructorArgs: ["$token"]`.
  There is no owner parameter, so `$owner` is not used anywhere.
- Pool (from the launch guidance): pair against native ETH (zero address), fee 3000, tickSpacing 60,
  initialPrice `79228162514264337593543950336`, no hook. These are pool parameters, not a valuation.
- Network: Sepolia, chain id 11155111. Deployment goes only through the admitted deployer and
  ProjectFactory. This repository contains no keys, no broadcast scripts, and no hard-coded wallets.

## Operational responsibilities

- Nobody operates the raffle. Anyone may call `settle` once a reveal window ends, so the website should
  offer that button. Until someone settles, the next round cannot start.
- Buyers must keep their secret, for example in browser storage or a backup, and reveal inside the
  window. A lost secret or a missed window forfeits the ticket.
- Winners must call `claim` themselves.
