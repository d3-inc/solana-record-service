# SRS Record Data Format

On-chain record accounts store resolution data as a **Borsh-serialized** `SrsRecordData` blob. The format is shared between forward resolution (name → wallet) and reverse resolution (wallet → name).

---

## Top-level container

Every record account's `data` field begins with an 8-byte ASCII discriminator (`"mappings"`) followed by a Borsh-encoded vector of `SrsMapping` entries.

```rust
struct SrsRecordData {
    // Fixed 8-byte discriminator: ASCII "mappings"
    discriminator: [u8; 8],
    mappings: Vec<SrsMapping>,
}
```

---

## SrsMapping

Each mapping entry carries a type tag and an opaque payload. The payload is itself Borsh-encoded and interpreted according to `mapping_type`.

```rust
struct SrsMapping {
    mapping_type: u8,
    data: Vec<u8>, // Borsh-encoded payload; schema depends on mapping_type
}
```

Known `mapping_type` values:

| Value | Name            | Used for           |
| ----- | --------------- | ------------------ |
| `1`   | `WalletMapping` | Forward resolution |
| `2`   | `NameMapping`   | Reverse resolution |

Unknown type values are ignored during deserialization to allow forward compatibility.

---

## WalletMapping (type = 1)

Stores a wallet address for a specific blockchain, identified by a [CAIP-2](https://github.com/ChainAgnostic/CAIPs/blob/main/CAIPs/caip-2.md) chain identifier. A record account may contain multiple `WalletMapping` entries, one per chain.

The wildcard namespace `solana:_` (per [CAIP-363](https://github.com/ChainAgnostic/CAIPs/blob/main/CAIPs/caip-363.md)) is the default Solana chain identifier.

```rust
struct WalletMapping {
    chain_caip2: String, // e.g. "solana:_", "eip155:1", "bip122:_"
    address: String,     // chain-native address string
}
```

---

## NameMapping (type = 2)

Stores the name that a wallet maps back to. Used in reverse resolution records, where the PDA seed is the wallet's public key bytes instead of a namehash.

```rust
struct NameMapping {
    sld: String, // second-level domain, e.g. "example"
    tld: String, // top-level domain, e.g. "com"
}
```

The full name is reconstructed as `{sld}.{tld}` and then normalized via IDNA/UTS#46 (lowercase, punycode).

---

## Record account layout

The record account structure that wraps the data blob:

```rust
struct Record {
    class: Pubkey,       // class/registry this record belongs to
    owner: Pubkey,       // owner of the record
    is_frozen: bool,
    expiry: i64,         // Unix timestamp; 0 = no expiry
    seed: Vec<u8>,       // PDA seed used to derive this account's address
    data: Vec<u8>,       // SrsRecordData blob described above
}
```

### PDA derivation

Record PDAs are derived from:

```
seeds = [b"record", class_pubkey, record_seed]
```

- **Forward records**: `record_seed` is the Namehash of the normalized domain name (see below).
- **Reverse records**: `record_seed` is the raw 32-byte public key of the wallet.

### Namehash

Domain names are hashed using recursive Keccak-256:

```
namehash("") = [0u8; 32]
namehash(label.parent) = keccak256(namehash(parent) ++ keccak256(label_bytes))
```

The name is normalized (IDNA/UTS#46) and split on `.` before hashing, processing labels from TLD to SLD.
