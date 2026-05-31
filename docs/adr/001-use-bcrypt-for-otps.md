# ADR 001: Use bcrypt for OTP Hashing

## Context
One-Time Passwords (OTPs) are the primary factor of authentication for voters after providing their Voter ID. They must be securely stored in the database to prevent brute-force attacks and off-line cracking if the database is ever compromised. 

## Decision
We will use `bcrypt` with a cost factor of `10` to hash OTPs before storing them.

## Consequences
- **Positive:** OTPs cannot be easily reversed or brute-forced offline due to the deliberate slowness of bcrypt.
- **Negative:** Hashing is CPU-intensive. Under high load (e.g. thousands of simultaneous voters logging in), this will consume significant backend CPU.
- **Mitigation:** We are implementing strict rate-limiting (`express-rate-limit`) on the OTP request and verification endpoints to prevent overwhelming the server and to stop online brute-forcing.

## Status
Accepted
