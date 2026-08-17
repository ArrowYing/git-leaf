---
title: Mermaid Smart View Fixture
---

# Mermaid Smart View Fixture

This document is a stable acceptance fixture for a dense directed graph. The diagram intentionally
contains a long primary path, converging inputs, and a feedback loop. OpenGlance must keep all thirteen
nodes and sixteen relationships while providing a readable entry point.

```mermaid
flowchart LR
    INPUT["Input Sources"]
    RECORDS["Source Records"]
    SEGMENTS["Normalized Segments"]
    VALIDATE["Extract + Validate"]
    CANONICAL["Canonical Records"]
    STATE_WRITER["State Writer"]
    SNAPSHOT["State Snapshot"]
    CONTEXT["Context Builder"]
    PLAN["Decision Plan<br/>Goal + Strategy + Steps"]
    DRAFT["Draft Artifact"]
    REVIEW["Review"]
    OUTCOME["Observed Outcome"]
    DELTA["State Change Proposal"]

    INPUT --> RECORDS
    RECORDS --> SEGMENTS
    SEGMENTS --> VALIDATE
    VALIDATE --> CANONICAL
    CANONICAL --> STATE_WRITER
    STATE_WRITER --> SNAPSHOT
    INPUT --> CONTEXT
    CANONICAL --> CONTEXT
    SNAPSHOT --> CONTEXT
    CONTEXT --> PLAN
    PLAN --> DRAFT
    DRAFT --> REVIEW
    DRAFT --> OUTCOME
    OUTCOME --> RECORDS
    OUTCOME --> DELTA
    DELTA --> STATE_WRITER
```
