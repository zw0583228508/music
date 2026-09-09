### bass — 2 task(s), GM 34, 39

| arm | n | score | play.err (1.0) | play.err (calibrated) | playable range | idiomatic register | chord-tone | coverage | density Δ (log2) | repetition | clash | wins vs human | wins vs ref |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| HUMAN_ORIGIN_REFERENCE | 6 | 88.0 | 0.00 | 0.00 | 1.00 | 1.00 | 0.82 | 0.75 | 0.00 | 0.52 | 0.14 | — | 100 % |
| REFERENCE_PART_COMPOSER | 6 | 45.2 | 0.00 | 0.00 | 1.00 | 1.00 | 1.00 | 0.56 | -2.63 | 0.29 | 0.16 | 0 % | — |
| CONTEXT_AWARE_ARRANGER | 6 | 45.2 | 0.00 | 0.00 | 1.00 | 1.00 | 1.00 | 0.56 | -2.63 | 0.29 | 0.16 | 0 % | 0 % |
| COMPOSERS_ASSISTANT_2 | 6 | 79.8 | 0.00 | 0.00 | 1.00 | 1.00 | 0.79 | 1.00 | 0.33 | 0.71 | 0.04 | 50 % | 100 % |
| COMPOSERS_ASSISTANT_2+CTX | 6 | 79.8 | 0.00 | 0.00 | 1.00 | 1.00 | 0.79 | 1.00 | 0.33 | 0.71 | 0.04 | 50 % | 100 % |

- **REFERENCE_PART_COMPOSER** — strong: playable: 0 errors per entry (calibrated judge); idiomatic register: 100% of notes inside the instrument's standard range. Weak: thin: plays in 56% of bars; density 2.63 octave(s) from the human part (sparser); chord tones only (1): no passing or neighbour tones; 16% of sounding time a semitone from the context.
- **CONTEXT_AWARE_ARRANGER** — strong: playable: 0 errors per entry (calibrated judge); idiomatic register: 100% of notes inside the instrument's standard range. Weak: thin: plays in 56% of bars; density 2.63 octave(s) from the human part (sparser); chord tones only (1): no passing or neighbour tones; 16% of sounding time a semitone from the context.
- **COMPOSERS_ASSISTANT_2** — strong: highest proxy score among the 4 machine arms (79.75); playable: 0 errors per entry (calibrated judge); idiomatic register: 100% of notes inside the instrument's standard range; full: plays in 100% of bars; chord-tone share 0.7931 ≈ human 0.8231. Weak: 71% of bars repeat the previous bar verbatim; out-scores the human on 50% of cells — distrust the judge here (judgeSuspect).
- **COMPOSERS_ASSISTANT_2+CTX** — strong: highest proxy score among the 4 machine arms (79.75); playable: 0 errors per entry (calibrated judge); idiomatic register: 100% of notes inside the instrument's standard range; full: plays in 100% of bars; chord-tone share 0.7931 ≈ human 0.8231. Weak: 71% of bars repeat the previous bar verbatim; out-scores the human on 50% of cells — distrust the judge here (judgeSuspect).

### brass — 2 task(s), GM 57, 58

| arm | n | score | play.err (1.0) | play.err (calibrated) | playable range | idiomatic register | chord-tone | coverage | density Δ (log2) | repetition | clash | wins vs human | wins vs ref |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| HUMAN_ORIGIN_REFERENCE | 6 | 65.1 | 2.50 | 0.00 | 1.00 | 1.00 | 0.81 | 0.81 | 0.00 | 0.00 | 0.04 | — | 50 % |
| REFERENCE_PART_COMPOSER | 6 | 66.8 | 0.00 | 0.00 | 1.00 | 1.00 | 1.00 | 0.38 | -1.92 | 0.00 | 0.21 | 50 % | — |
| CONTEXT_AWARE_ARRANGER | 6 | 66.8 | 0.00 | 0.00 | 1.00 | 1.00 | 1.00 | 0.38 | -1.92 | 0.00 | 0.21 | 50 % | 0 % |
| COMPOSERS_ASSISTANT_2 | 6 | 51.2 | 2.67 | 0.00 | 1.00 | 1.00 | 0.54 | 1.00 | 1.18 | 0.07 | 0.14 | 33 % | 33 % |
| COMPOSERS_ASSISTANT_2+CTX | 6 | 53.0 | 1.00 | 0.00 | 0.99 | 0.99 | 0.47 | 1.00 | 1.18 | 0.07 | 0.15 | 50 % | 33 % |

- **REFERENCE_PART_COMPOSER** — strong: highest proxy score among the 4 machine arms (66.85); playable: 0 errors per entry (calibrated judge); idiomatic register: 100% of notes inside the instrument's standard range. Weak: thin: plays in 38% of bars; density 1.92 octave(s) from the human part (sparser); chord tones only (1): no passing or neighbour tones; 21% of sounding time a semitone from the context; out-scores the human on 50% of cells — distrust the judge here (judgeSuspect).
- **CONTEXT_AWARE_ARRANGER** — strong: highest proxy score among the 4 machine arms (66.85); playable: 0 errors per entry (calibrated judge); idiomatic register: 100% of notes inside the instrument's standard range. Weak: thin: plays in 38% of bars; density 1.92 octave(s) from the human part (sparser); chord tones only (1): no passing or neighbour tones; 21% of sounding time a semitone from the context; out-scores the human on 50% of cells — distrust the judge here (judgeSuspect).
- **COMPOSERS_ASSISTANT_2** — strong: playable: 0 errors per entry (calibrated judge); idiomatic register: 100% of notes inside the instrument's standard range; full: plays in 100% of bars. Weak: lowest proxy score among the 4 machine arms (51.21); density 1.23 octave(s) from the human part (denser); 14% of sounding time a semitone from the context.
- **COMPOSERS_ASSISTANT_2+CTX** — strong: playable: 0 errors per entry (calibrated judge); idiomatic register: 99% of notes inside the instrument's standard range; full: plays in 100% of bars. Weak: density 1.23 octave(s) from the human part (denser); 15% of sounding time a semitone from the context; out-scores the human on 50% of cells — distrust the judge here (judgeSuspect).

### keys — 2 task(s), GM 0

| arm | n | score | play.err (1.0) | play.err (calibrated) | playable range | idiomatic register | chord-tone | coverage | density Δ (log2) | repetition | clash | wins vs human | wins vs ref |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| HUMAN_ORIGIN_REFERENCE | 6 | 100.0 | 0.00 | 0.00 | 1.00 | 1.00 | 0.73 | 1.00 | 0.00 | 0.00 | 0.03 | — | 100 % |
| REFERENCE_PART_COMPOSER | 6 | 66.4 | 0.00 | 0.00 | 1.00 | 1.00 | 1.00 | 0.56 | -3.18 | 0.17 | 0.05 | 0 % | — |
| CONTEXT_AWARE_ARRANGER | 6 | 64.3 | 0.00 | 0.00 | 1.00 | 1.00 | 0.93 | 0.56 | -3.18 | 0.08 | 0.04 | 0 % | 50 % |
| COMPOSERS_ASSISTANT_2 | 6 | 76.3 | 0.00 | 0.00 | 1.00 | 1.00 | 0.79 | 0.75 | -0.38 | 0.00 | 0.02 | 0 % | 50 % |
| COMPOSERS_ASSISTANT_2+CTX | 6 | 76.1 | 0.00 | 0.00 | 1.00 | 1.00 | 0.82 | 0.75 | -0.38 | 0.00 | 0.06 | 0 % | 50 % |

- **REFERENCE_PART_COMPOSER** — strong: playable: 0 errors per entry (calibrated judge); idiomatic register: 100% of notes inside the instrument's standard range. Weak: thin: plays in 56% of bars; density 3.18 octave(s) from the human part (sparser); chord tones only (1): no passing or neighbour tones.
- **CONTEXT_AWARE_ARRANGER** — strong: playable: 0 errors per entry (calibrated judge); idiomatic register: 100% of notes inside the instrument's standard range. Weak: lowest proxy score among the 4 machine arms (64.27); thin: plays in 56% of bars; density 3.18 octave(s) from the human part (sparser).
- **COMPOSERS_ASSISTANT_2** — strong: highest proxy score among the 4 machine arms (76.27); playable: 0 errors per entry (calibrated judge); idiomatic register: 100% of notes inside the instrument's standard range; chord-tone share 0.7917 ≈ human 0.7262; clean against the context (2% clash). Weak: nothing stands out.
- **COMPOSERS_ASSISTANT_2+CTX** — strong: playable: 0 errors per entry (calibrated judge); idiomatic register: 100% of notes inside the instrument's standard range; chord-tone share 0.8222 ≈ human 0.7262. Weak: nothing stands out.

### organ — 2 task(s), GM 19, 23

| arm | n | score | play.err (1.0) | play.err (calibrated) | playable range | idiomatic register | chord-tone | coverage | density Δ (log2) | repetition | clash | wins vs human | wins vs ref |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| HUMAN_ORIGIN_REFERENCE | 6 | 100.0 | 0.00 | 0.00 | 1.00 | 1.00 | 0.81 | 1.00 | 0.00 | 0.00 | 0.05 | — | 100 % |
| REFERENCE_PART_COMPOSER | 6 | 65.6 | 0.00 | 0.00 | 1.00 | 1.00 | 1.00 | 0.63 | -1.66 | 0.29 | 0.08 | 0 % | — |
| CONTEXT_AWARE_ARRANGER | 6 | 69.2 | 0.00 | 0.00 | 1.00 | 1.00 | 1.00 | 0.63 | -1.66 | 0.14 | 0.08 | 0 % | 50 % |
| COMPOSERS_ASSISTANT_2 | 6 | 85.0 | 0.00 | 0.00 | 1.00 | 1.00 | 0.95 | 1.00 | -0.75 | 0.17 | 0.01 | 0 % | 100 % |
| COMPOSERS_ASSISTANT_2+CTX | 6 | 88.9 | 0.00 | 0.00 | 1.00 | 1.00 | 0.95 | 1.00 | -0.75 | 0.17 | 0.01 | 0 % | 100 % |

- **REFERENCE_PART_COMPOSER** — strong: playable: 0 errors per entry (calibrated judge); idiomatic register: 100% of notes inside the instrument's standard range. Weak: lowest proxy score among the 4 machine arms (65.58); density 1.66 octave(s) from the human part (sparser); chord tones only (1): no passing or neighbour tones.
- **CONTEXT_AWARE_ARRANGER** — strong: playable: 0 errors per entry (calibrated judge); idiomatic register: 100% of notes inside the instrument's standard range. Weak: density 1.66 octave(s) from the human part (sparser); chord tones only (1): no passing or neighbour tones.
- **COMPOSERS_ASSISTANT_2** — strong: playable: 0 errors per entry (calibrated judge); idiomatic register: 100% of notes inside the instrument's standard range; full: plays in 100% of bars; clean against the context (1% clash). Weak: nothing stands out.
- **COMPOSERS_ASSISTANT_2+CTX** — strong: highest proxy score among the 4 machine arms (88.94); playable: 0 errors per entry (calibrated judge); idiomatic register: 100% of notes inside the instrument's standard range; full: plays in 100% of bars; clean against the context (1% clash). Weak: nothing stands out.

### reed — 2 task(s), GM 64, 65

| arm | n | score | play.err (1.0) | play.err (calibrated) | playable range | idiomatic register | chord-tone | coverage | density Δ (log2) | repetition | clash | wins vs human | wins vs ref |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| HUMAN_ORIGIN_REFERENCE | 6 | 94.0 | 0.50 | 0.00 | 1.00 | 1.00 | 0.67 | 0.94 | 0.00 | 0.00 | 0.01 | — | 100 % |
| REFERENCE_PART_COMPOSER | 6 | 66.3 | 0.50 | 0.50 | 0.88 | 0.88 | 1.00 | 0.50 | -2.99 | 0.00 | 0.00 | 0 % | — |
| CONTEXT_AWARE_ARRANGER | 6 | 76.0 | 0.00 | 0.00 | 1.00 | 1.00 | 1.00 | 0.50 | -2.99 | 0.00 | 0.00 | 0 % | 50 % |
| COMPOSERS_ASSISTANT_2 | 6 | 87.6 | 0.50 | 0.00 | 1.00 | 1.00 | 0.86 | 1.00 | -0.45 | 0.00 | 0.03 | 0 % | 100 % |
| COMPOSERS_ASSISTANT_2+CTX | 6 | 87.0 | 0.50 | 0.00 | 1.00 | 1.00 | 0.86 | 1.00 | -0.45 | 0.00 | 0.03 | 0 % | 100 % |

- **REFERENCE_PART_COMPOSER** — strong: clean against the context (0% clash). Weak: lowest proxy score among the 4 machine arms (66.25); unplayable notes: 0.5 errors per entry (calibrated judge); most playability errors of the 4 machine arms; thin: plays in 50% of bars; density 2.99 octave(s) from the human part (sparser); chord tones only (1): no passing or neighbour tones.
- **CONTEXT_AWARE_ARRANGER** — strong: playable: 0 errors per entry (calibrated judge); idiomatic register: 100% of notes inside the instrument's standard range; clean against the context (0% clash). Weak: thin: plays in 50% of bars; density 2.99 octave(s) from the human part (sparser); chord tones only (1): no passing or neighbour tones.
- **COMPOSERS_ASSISTANT_2** — strong: highest proxy score among the 4 machine arms (87.6); playable: 0 errors per entry (calibrated judge); idiomatic register: 100% of notes inside the instrument's standard range; full: plays in 100% of bars. Weak: nothing stands out.
- **COMPOSERS_ASSISTANT_2+CTX** — strong: playable: 0 errors per entry (calibrated judge); idiomatic register: 100% of notes inside the instrument's standard range; full: plays in 100% of bars. Weak: nothing stands out.

### strings — 2 task(s), GM 40

| arm | n | score | play.err (1.0) | play.err (calibrated) | playable range | idiomatic register | chord-tone | coverage | density Δ (log2) | repetition | clash | wins vs human | wins vs ref |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| HUMAN_ORIGIN_REFERENCE | 6 | 95.2 | 0.00 | 0.00 | 1.00 | 1.00 | 0.88 | 0.75 | 0.00 | 0.00 | 0.06 | — | 100 % |
| REFERENCE_PART_COMPOSER | 6 | 67.4 | 0.00 | 0.00 | 1.00 | 1.00 | 1.00 | 0.31 | -4.18 | 0.00 | 0.04 | 0 % | — |
| CONTEXT_AWARE_ARRANGER | 6 | 66.0 | 0.00 | 0.00 | 1.00 | 1.00 | 0.96 | 0.31 | -4.18 | 0.00 | 0.04 | 0 % | 0 % |
| COMPOSERS_ASSISTANT_2 | 6 | 58.1 | 0.00 | 0.00 | 1.00 | 1.00 | 0.71 | 0.63 | -0.28 | 0.00 | 0.12 | 17 % | 33 % |
| COMPOSERS_ASSISTANT_2+CTX | 6 | 56.2 | 0.00 | 0.00 | 1.00 | 1.00 | 0.75 | 0.63 | -0.28 | 0.00 | 0.15 | 17 % | 50 % |

- **REFERENCE_PART_COMPOSER** — strong: highest proxy score among the 4 machine arms (67.43); playable: 0 errors per entry (calibrated judge); idiomatic register: 100% of notes inside the instrument's standard range. Weak: thin: plays in 31% of bars; density 4.18 octave(s) from the human part (sparser); chord tones only (1): no passing or neighbour tones.
- **CONTEXT_AWARE_ARRANGER** — strong: playable: 0 errors per entry (calibrated judge); idiomatic register: 100% of notes inside the instrument's standard range; chord-tone share 0.9643 ≈ human 0.8808. Weak: thin: plays in 31% of bars; density 4.18 octave(s) from the human part (sparser).
- **COMPOSERS_ASSISTANT_2** — strong: playable: 0 errors per entry (calibrated judge); idiomatic register: 100% of notes inside the instrument's standard range. Weak: density 1.51 octave(s) from the human part (sparser); 12% of sounding time a semitone from the context.
- **COMPOSERS_ASSISTANT_2+CTX** — strong: playable: 0 errors per entry (calibrated judge); idiomatic register: 100% of notes inside the instrument's standard range. Weak: lowest proxy score among the 4 machine arms (56.16); density 1.51 octave(s) from the human part (sparser); 15% of sounding time a semitone from the context.

