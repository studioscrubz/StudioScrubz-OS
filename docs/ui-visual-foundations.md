# StudioScrubz OS visual foundations

## Brand and semantic color

- Dark green (`--brand-green`, source `#143D1A`) identifies StudioScrubz, headings, navigation, and primary actions.
- Gold (`--brand-gold`, source `#D4AF37`) is an accent for focus, borders, and indicators. Use `--status-warning-fg` instead of raw gold for small text on white.
- Status meaning is consistent: success = completed/positive, info = active work, warning = pending/attention, danger = failed/urgent/overdue, neutral = inactive/historical.
- Never communicate state by color alone. `StatusBadge` always renders visible text.

## Shared components

- `PageHeader`: title, description, optional eyebrow/actions, and optional hero treatment.
- `MetricCard`: value with optional hint and semantic tone. Original label-only calls remain supported.
- `SectionCard`: bounded content section with optional title, description, and action.
- `StatusBadge`: centralized status-to-tone mapping. Override tone only when context changes meaning.
- `Alert`: accessible status or error message; danger uses an assertive announcement.
- `Button`: primary, secondary, quiet, and danger actions with appropriate touch heights.

## Layout conventions

- Use `gap-3` for compact controls, `gap-4` for card grids, and `gap-6` for major regions.
- Use `p-4` on mobile and `p-6` on larger section cards.
- Use `rounded-2xl` for major surfaces and `rounded-lg` or `rounded-xl` for nested controls.
- Prefer semantic CSS variables over literal hex colors so light and dark themes stay aligned.

Phase 1 introduces foundations only. Existing pages migrate incrementally in separately reviewed changes.
