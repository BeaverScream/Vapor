# Document Template

Title: 
Date:

## Purpose
A short (1-3 sentence) description of why this document exists and what decision or knowledge it captures.

## Scope / Audience
- Scope: (what this doc covers)
- Audience: (who should read and act on this doc)

## Table of Contents
- Use a Table of Contents for documents with more than 3 major sections or > ~300 lines.
- Use anchor links to allow quick navigation for humans and agents. Example:
  - [Overview](#overview)
  - [Design](#design)
  - [Tests](#tests)

## Guidelines
- Include `Title`, `Date`, `Owner`, and `Status` at the top for every new document.
- Use clear headers (H2/H3) and descriptive section titles so Markdown anchors are stable.
- When linking to other workspace docs, use workspace-relative paths (e.g., `docs/system_design/INDEX.md`).
- Do not include secrets or plaintext tokens in docs.

## Anchors and Quick-jump
- Use GitHub-style header anchors for quick-jump links (lowercase, spaces -> hyphens). Example: `# design-decisions` becomes `#design-decisions`.
- For long documents, add a small "Quick Links" section near the top with frequently referenced anchors.

## Example Sections (skeleton)

### Overview
Short overview.

### Design
Detailed design and tradeoffs.

### API / Contract
Events, payloads, error codes, example messages.

### Tests & Verification
What to test, expected behavior, relevant test IDs.

### Change Log
- YYYY-MM-DD: Owner — note


---
Small checklist for authors:
- [ ] Title, Date, Owner, Status present
- [ ] Purpose & Scope written
- [ ] TOC or Quick Links if applicable
- [ ] Anchors for major sections added
- [ ] Links use workspace-relative paths

