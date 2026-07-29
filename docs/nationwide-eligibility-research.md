# Nationwide eligibility research

Last reviewed: 2026-07-29

## Coverage

BridgeAid has 52 national entries: 42 online or national actions and 10 records
already scoped as provider directories. Two additional national legal-aid
records are also classified as directories by eligibility type. Every entry now
has:

- eligibility type
- structured eligibility rules
- relevant quiz-question identifiers
- official source name and HTTPS source URL
- last eligibility review date
- confidence
- eligibility notes
- state-variation and official-confirmation flags
- a manual-review flag

The authoritative per-resource profiles are in
`data/nationwide-eligibility-research.js`. They are applied to the public
resource model in `data/resources.js`; a missing profile defaults to low
confidence and manual review.

## Research method

Program rules were compared with the official federal, state-selector, or
administering-organization eligibility page already attached to each resource.
The 2026 review additionally checked current official guidance for the major
rule families, including:

- Job Corps admissions criteria and age exceptions
- Health Insurance Marketplace enrollment criteria
- Social Security disability, retirement, Medicare, and 2026 SSI criteria
- VA health, disability, education, pension, and VR&E criteria
- 2026 Lifeline income and qualifying-program pathways
- 2026 IRS Free File and VITA/TCE criteria
- FAFSA federal student-aid requirements
- USCIS naturalization requirements
- Head Start, child-care assistance, WIC, and SUN Meals rules
- USAJOBS hiring paths and announcement-specific qualifications

Directories and screening tools are not treated as benefit programs. State
selectors are marked as state-varying. Funding, inventory, provider capacity,
medical determinations, work credits, immigration exceptions, employer
qualifications, and discretionary awards remain subject to official review.

## Matching safeguards

The matcher evaluates only stored mandatory rules. It returns:

- **Likely match** only when every machine-checkable mandatory rule is answered
  and passes, with no manual-review requirement.
- **Possible match** when a direct program has unanswered machine-checkable
  requirements but no answered rule fails.
- **More information needed** for directories, state variation, discretionary
  criteria, or records requiring official or human review.
- **Unlikely match** when an answered mandatory rule clearly fails.

Uncertain programs remain visible. The quiz asks no more than eight relevant
questions, supports skip and back, requests ranges rather than exact financial
figures, and does not persist answers.

## Review queue

Twenty-five entries intentionally require manual confirmation. The exported
`nationwideEligibilityReviewQueue()` function provides the resource ID, name,
official source, and review reason for administrative follow-up. This queue is
not a public admin interface and does not bypass server authorization.
