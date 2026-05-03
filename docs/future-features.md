# Future Features

## Operator Job Splitting (WO Self-Assignment)

Floor operators create their own Work Orders from an MO, deciding machine count and qty per run.

**Context:** Small factory — operators know machine availability and capacity. Planner sets target qty on MO, operator decides execution split.

**Agreed design:**
- Operator opens MO on mobile, sees: target qty, tolerance band, sum of existing WO qtys, remaining
- "Add Run": pick work center + enter qty
- Default qty pre-filled as remaining (MO qty - sum of existing WOs)
- Warn if cumulative WO qty exceeds `MO qty × (1 + tolerance/100)`; still allow override
- Under-assignment always fine (production in progress)

**Pre-checks before implementing:**
- Verify `WorkOrder` model has `work_center_id` and `qty`
- Verify MO carries `tolerance_percentage` or needs to inherit from BOM at runtime
