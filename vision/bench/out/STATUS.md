## Status: COOL and AWS runs blocked (2026-10-26)

Only the Mac arm64 stock baseline below has been measured. The COOL-on-Graviton, stock-on-Graviton and stock-on-x86 runs did not happen before the 20:30 PT cutoff, for two reasons:

- The AWS account is on the Free plan, which rejects `c8g.xlarge` and `c7i.xlarge` ("not eligible for Free Tier") and Marketplace AMIs.
- The COOL Graviton4 AMI subscription is not yet accepted.

So this file has no COOL numbers and makes no COOL speedup claim. To finish, upgrade the account, subscribe to the COOL AMI, run `cd infra && ./60-bench-instances.sh up` on branch `oh-cv-aws` (it starts stock c8g, COOL c8g and stock c7i, reachable over SSM only), then run `bench.py` on each host as `vision/bench/README.md` describes. Copy the JSON files back through `s3://halloween-vision-bench-401921623247` into `vision/bench/out/` and run `python3 vision/bench/compare.py`.
