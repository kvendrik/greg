## Functionality

- [ ] Allow agent to background long running jobs like `tg --voice` or `voicecall`
- [ ] QMD `search_memory` is broken. QMD.healthy() is also broken. `greg tools memory_search --search-query "friends"`

## Security

- [ ] Better security for `exec()` so allowlist set makes sense
- [ ] Pre-exec policy for dangerous patterns
- [ ] Add /1hour to allowlist commands
- [ ] Forbid modifying certains paths. Should for example not be able to modify root or policy paths
