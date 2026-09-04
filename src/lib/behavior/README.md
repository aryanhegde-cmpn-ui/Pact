# behavior

Pure analysis functions. No I/O, no database access, no `fetch`, no clock reads
that are not passed in as arguments.

Everything here takes an event log (or a slice of one) and returns a derived
value. Keeping it pure is what makes behavioural metrics testable without a
network and recomputable from history at any time -- see the event log rule in
`CLAUDE.md`.

Empty until the first analysis lands.
