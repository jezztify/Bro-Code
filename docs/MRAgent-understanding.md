# Understanding MRAgent: an LLM-based Automated Agent for Causal Knowledge Discovery via Mendelian Randomization

Source: Xu et al., _Briefings in Bioinformatics_, 2025, 26(2), bbaf140. https://doi.org/10.1093/bib/bbaf140

## 1. The problem being solved

Mendelian Randomization (MR) is a causal-inference technique that uses genetic variants as **instrumental variables (IVs)** to test whether a modifiable exposure causally affects an outcome — analogous to randomization in an RCT, but exploiting the fact that alleles are randomly assorted at conception (so they aren't confounded by reverse causation or most environmental confounders).

The bottleneck in practice isn't the statistics — it's everything _around_ the statistics:

1. Finding plausible exposure-outcome pairs worth testing (usually from literature/clinical experience).
2. Checking whether that pair has already been MR-tested (avoiding redundant work).
3. Judging the quality of any prior MR study.
4. Mapping a clinical concept (e.g. "BMI") to the correct GWAS dataset ID, handling synonyms and population-matching.
5. Running the actual two-sample MR computation.
6. Interpreting/reporting statistical output (effect sizes, heterogeneity, pleiotropy) in plain biomedical language.

MRAgent automates steps 1–6 using an LLM as the "brain," CSV files as "memory," and a fixed external toolkit (PubMed/PMC, OpenGWAS, UMLS, TwoSampleMR, MRlap, STROBE-MR) for "perception and action."

## 2. Architecture

Following the agent taxonomy of Xi et al. (Brain / Perception / Action):

- **Brain** = LLM, doing three jobs:
    - _Knowledge_ — biomedical domain knowledge (e.g., recognizing that "Waist-to-hip ratio adjusted for BMI" is not the same trait as "BMI").
    - _Analysis_ — interpreting statistical results into written conclusions.
    - _Process control_ — the LLM's structured outputs (JSON/CSV-like) are parsed by Python and drive which branch of the workflow executes next (a ReAct-style reasoning→action loop).
- **Memory** = three CSV "data sheets," kept in (roughly) normal form to avoid redundancy:
    - `exposure_and_outcome` — candidate pairs, source paper titles, whether prior MR exists, GWAS availability, an `oeID` grouping synonym-variants of the same semantic pair.
    - `outcome` — per-trait info: synonyms (grouped by `sID`), list of matching GWAS IDs.
    - `run` — the final, deduplicated set of pairs queued for actual MR computation.
- **Perception & Action toolkit**:
    - PubMed/PMC — literature search and full text retrieval.
    - UMLS Terminology Services — synonym expansion for medical concepts.
    - OpenGWAS — GWAS summary statistics lookup (csv or online mode).
    - TwoSampleMR (R package) — runs the actual MR estimators; also offers **MR-MOE** (mixture-of-experts method selection).
    - MRlap — corrects MR estimates for **sample overlap** between exposure/outcome GWAS and weak-instrument bias.
    - STROBE-MR — a 20-item checklist standard for judging the reporting quality of a published MR study.

## 3. Workflow (9 steps), and the math/stats embedded in each

The agent reproduces the manual MR workflow but inserts LLM calls and toolkit calls at each stage.

**Step 1 — Identify exposure/outcome.** LLM reads N PubMed abstracts for a disease keyword and extracts candidate exposure-outcome pairs (or the user inputs pairs directly — "Causal Validation" mode vs. literature-driven "Knowledge Discovery" mode).

**Step 2 — Check for prior MR analysis.** PubMed query with `(Exposure[Title/Abstract]) AND (Outcome[Title/Abstract]) AND (MR[Title/Abstract])`; LLM gives binary Yes/No on whether the pair was already MR-tested. Optionally invokes STROBE-MR scoring (20 binary checklist items) to flag _low-quality_ prior MR studies, which get re-queued rather than discarded — i.e. "already studied" is not accepted at face value unless the study meets a quality bar defined by user-chosen "critical" checklist items.

**Step 3 — Synonym expansion.** UMLS assigns a shared `sID` to all synonym terms of a trait, so downstream GWAS keyword search isn't limited to one phrasing.

**Step 4 — Check GWAS availability** in OpenGWAS by keyword; traits with zero hits are pruned (marked FALSE).

**Step 5 — Select GWAS ID(s).** LLM disambiguates among keyword-matched GWAS trait descriptions (e.g., picks "Body mass index (BMI)" over "Waist-to-hip ratio adjusted for BMI"), outputting a Python list of valid GWAS IDs per trait.

**Step 6 — Recombine pairs.** Cartesian product of exposure-synonym-list × outcome-synonym-list, all tagged with a shared `oeID` (same underlying semantic pair, multiple lexical realizations). If bidirectional MR is requested, the pair is duplicated with exposure/outcome swapped.

**Step 7 — Re-check prior MR** on the expanded synonym set (same logic as Step 2 — if _any_ synonym-variant of the pair was already validly studied, all variants under that `oeID` are excluded).

**Step 8 — Screen final pairs** into the `run` table: must have (a) no valid prior MR, (b) GWAS data present for both sides.

**Step 9 — Run MR and interpret.**

- Re-verifies exposure/outcome GWAS come from the **same population** (a core MR validity requirement — population-stratification mismatch biases estimates).
- For every exposure GWAS ID × outcome GWAS ID combination, runs **TwoSampleMR** (classical methods or MR-MOE).
- Optionally runs **MRlap** to correct for sample overlap / weak instruments.
- LLM writes a natural-language report per pair per GWAS-ID-combination, then a consolidated summary report across all combinations for that exposure-outcome pair.

## 4. The statistical/mathematical core (MR estimators)

Although the paper itself doesn't re-derive MR estimator formulas (it delegates this to the TwoSampleMR package), the proof-of-concept report (Fig. 5) names the actual methods MRAgent invokes — these are the real math underpinning every "causal" claim the agent makes:

For each SNP _i_ used as an instrument, let:

- β̂ₓᵢ = SNP–exposure association estimate, with standard error σₓᵢ
- β̂ᵥᵢ = SNP–outcome association estimate, with standard error σᵥᵢ

**Inverse-Variance Weighted (IVW)** — the primary method reported by MRAgent. It's a weighted linear regression of outcome effects on exposure effects, through the origin, weighting each SNP by the inverse variance of its outcome effect:

β̂_IVW = Σᵢ (β̂ₓᵢ β̂ᵥᵢ / σᵥᵢ²) / Σᵢ (β̂ₓᵢ² / σᵥᵢ²)

with standard error SE(β̂_IVW) = 1 / √(Σᵢ β̂ₓᵢ² / σᵥᵢ²). Equivalent to a fixed-effect meta-analysis of the per-SNP ratio estimates β̂ᵥᵢ/β̂ₓᵢ. Assumes every instrument is valid (no pleiotropy) for an unbiased estimate.

**MR-Egger** — same weighted regression but _with_ an intercept term:

β̂ᵥᵢ/σᵥᵢ = β₀ + β₁ (β̂ₓᵢ/σᵥᵢ) + εᵢ

β₁ is the pleiotropy-robust causal estimate; the intercept β₀ tests for **directional horizontal pleiotropy** (if significantly ≠ 0, instruments are systematically biased — this is exactly the "Egger intercept" test reported in the case study: _intercept = 0.00028 (SE 0.0052), P = 0.957_, i.e. no evidence of pleiotropy).

**Weighted median estimator** — orders the per-SNP ratio estimates β̂ᵥᵢ/β̂ₓᵢ weighted by inverse variance, and takes the weighted-median value. Consistent even if up to 50% of the instrument weight comes from invalid (pleiotropic) SNPs — more robust than IVW to a minority of bad instruments.

**Simple mode / Weighted mode** — clusters the per-SNP ratio estimates and reports the value of the mode of the (weighted) density of estimates; robust if the _largest_ cluster of SNPs gives a consistent (even if not majority) signal — i.e. robust under the **ZEMPA** (zero modal pleiotropy assumption) rather than strict majority/all-valid-instrument assumptions.

**Cochran's Q heterogeneity test** — checks whether per-SNP ratio estimates are more dispersed than sampling error alone would predict:

Q = Σᵢ wᵢ (β̂ᵥᵢ/β̂ₓᵢ − β̂_IVW)² ~ χ²(df = nSNP − 1)

A significant Q indicates heterogeneity, often a symptom of pleiotropy among instruments (in the case study: Q = 121.02, df = 99, P = 0.066 — borderline non-significant).

**Odds ratio conversion** — since GWAS effects are typically on a log-odds or per-SD scale, the final reported effect is OR = exp(β̂), with 95% CI = exp(β̂ ± 1.96·SE).

**MR-MOE (mixture-of-experts MR)** — rather than a single fixed estimator, a meta-model (trained on simulated GWAS scenarios) predicts, per dataset, which of several MR methods is likely least biased given the data's characteristics (instrument strength, suspected pleiotropy pattern, sample overlap, etc.), and weights/selects estimators accordingly. This is why the paper notes MR-MOE reports are harder for LLMs to interpret (more methodological nuance, less standard template, fewer training examples of human-written reports in this style).

**MRlap correction** — corrects the IVW-type estimate and its SE for two specific biases:

1. **Sample overlap** between the exposure and outcome GWAS (overlapping participants induce correlated estimation errors between β̂ₓᵢ and β̂ᵥᵢ, biasing naive two-sample MR toward the observational/confounded estimate).
2. **Weak instrument bias** (when instruments only weakly predict the exposure, lowering effective sample size inflates bias toward zero-overlap-equivalent confounding).
   MRlap is the most computationally expensive step in the whole pipeline (~1297 s average vs. <20 s for everything else) because it requires downloading full GWAS summary statistics rather than just the matched-SNP subset.

## 5. Evaluation methodology — the other set of formulas

The paper evaluates each LLM-dependent step with its own metric, distinct from the MR statistics above.

**a) Identifying exposure/outcome pairs** — human labeling (Label A/B/C via a decision tree: relevant-to-article & on-keyword / relevant-but-off-keyword / irrelevant) **plus** an automatic SimCSE-based similarity score between LLM-extracted pairs and a human reference list, computed via two algorithms:

- `LIST-PREPROCESS`: aligns the human and LLM lists index-by-index, builds a `mask` (1 if both lists have a non-empty entry at that index — comparable — 0 otherwise, e.g. one side empty).
- `SimCSE-SIMILARITY`: computes pairwise embedding cosine similarities for the aligned (masked) entries, zeroes out unmasked (non-comparable) entries, and averages:

    similarity_mean = mean(maskᵢ · cos_sim(hum_listᵢ, llm_listᵢ))

**b) Checking prior MR / STROBE-MR quality** — straightforward binary-classification **accuracy**:

Accuracy = (# correct predictions) / (total predictions) — Eq. (1)

against a manually-labeled ground truth (40 pairs: 20 with prior MR, 20 without; or per-item STROBE-MR checklist agreement).

**c) Selecting GWAS IDs** — classic information-retrieval **precision/recall/F1**, where A = expert-chosen GWAS ID set, B = LLM-chosen set, C = A ∩ B:

Precision = |C| / |B| — Eq. (3)
Recall = |C| / |A| — Eq. (4)
F1 = 2·Precision·Recall / (Precision + Recall) — Eq. (5)

averaged over 30 test diseases.

**d) Interpreting MR results (report generation)** — a single-blind human Likert evaluation (4 questions, 1–5 scale: factual accuracy to the actual numbers, biological plausibility, level of analytic detail, accuracy of final conclusion) plus SimCSE cosine similarity to a human-written reference report.

**e) Prompt-strategy comparison** — six prompting strategies (Zero-shot, Few-knowledge, One-shot, One-shot+Few-knowledge, Zero-shot-CoT, Zero-shot-CoT+Few-knowledge) ranked by blinded human experts; "One-shot + Few-knowledge" won, implying GPT-4o lacks intrinsic MR domain knowledge and needs both a worked example _and_ explicit domain facts — Chain-of-Thought prompting alone did not compensate for that knowledge gap.

## 6. Headline empirical results

- **GPT-4-Turbo** was overall the most reliable model across tasks; **Qwen-max** was competitive (best on GWAS-selection F1 = 0.7675 and MR-report Likert scores) but constrained by shorter context length, which made it fail outright on the STROBE-MR checklist task (20 items × full paper text exceeds its context window).
- **Claude-3-opus** had the _highest precision_ (0.9767) on GWAS ID selection (very conservative/accurate picks) but much lower recall (0.5797), and it failed the STROBE-MR task due to inability to reliably emit the required JSON format.
- Open-source models (`llama3:70b`, `mixtral:8x22b`) were respectable on simpler binary tasks (prior-MR-check accuracy ≈ 0.80, on par with GPT-4-Turbo) but degraded sharply on tasks needing fine-grained domain judgment (GWAS selection F1 ~0.40–0.51; MR-MOE report Likert scores ~1.5–2.0).
- In blinded scoring, LLM-written MR/MR-MOE reports **matched or exceeded** human-expert-written reports on the Likert scale — a notable claim that the bottleneck task (interpreting/reporting MR statistics in prose) is now at-or-above human level for top LLMs.
- Wall-clock savings are dramatic for the literature/judgment steps (seconds vs. tens of minutes per pair) but the actual numeric computation steps (TwoSampleMR ~18s, and especially MRlap's bias correction at ~1297s) are LLM-independent and dominate runtime once invoked.

## 7. Proof-of-concept case (back pain)

Input: outcome = "back pain", Knowledge Discovery mode, standard MR, GPT-4o, 300 PubMed abstracts reviewed, bidirectional + synonym options enabled.

MRAgent found, among others, exposure = "spondylolysis" → outcome = "low back pain", tested across two outcome GWAS IDs (`finn-b-M13_LOWBACKPAIN`, `ukb-d-M13_LOWBACKPAIN`). Both analyses showed positive, statistically significant IVW associations (e.g. β = 0.0715, SE = 0.0121, P = 3.04e-06, OR ≈ 1.074, 95% CI 1.049–1.10), corroborated by Weighted Median and MR-Egger, non-significant Cochran's Q (no strong heterogeneity), and a near-zero, non-significant Egger intercept (no detected pleiotropy) — i.e., consistent causal signal across multiple estimators and multiple underlying GWAS datasets, which the agent itself flags as the basis for a stronger causal claim than a single-method/single-dataset analysis would support. It similarly concluded a causal link between osteoarthritis and back pain.

## 8. Key takeaways

- MRAgent's actual novelty is **orchestration**, not new statistics: it bolts an LLM-driven ReAct control loop and CSV-based memory onto the existing, well-validated TwoSampleMR/MRlap/STROBE-MR toolchain, automating the labor-intensive literature triage and report-writing that previously gated large-scale MR studies.
- All causal validity still rests on classical MR assumptions (instrument relevance, independence from confounders, exclusion restriction/no horizontal pleiotropy) — the agent operationalizes _checks_ for some of these (Egger intercept, Cochran's Q, population matching, MRlap sample-overlap correction) but does not change the underlying statistical guarantees.
- The dedup/synonym-expansion machinery (`oeID`/`sID`, Cartesian product of synonym lists, re-checking prior MR after expansion) is the main engineering mechanism preventing redundant or missed analyses across lexical variants of the same biomedical concept.
- Model choice materially changes both _reliability_ (context-length limits, JSON-formatting brittleness) and _cost_ — the paper's practical recommendation leans toward GPT-4-Turbo/Qwen-max for production use, with open-source models viable only for the simpler binary-classification steps.
