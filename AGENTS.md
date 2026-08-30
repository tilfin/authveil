## Function ordering

For modules with a primary exported function, place the public/exported
function before module-private helper functions.

Prefer top-down readability:

1. Primary exported API
2. Secondary exported APIs
3. Internal implementation functions
4. Low-level utility functions

Use function declarations for private helpers when this ordering requires
hoisting.

## Module organization

Keep the source directory structure easy to understand by grouping modules by
responsibility and using clear, specific names.
