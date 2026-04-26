# theone_server

## Environment Variables

Add the following to your `.env` when enabling the BOT sandbox:

```
OPENAI_API_KEY=your-openai-api-key
OPENAI_MODEL=gpt-4o-mini
```

`OPENAI_MODEL` is optional; it defaults to `gpt-4o-mini` if omitted.

### Feature Flags

```
# Feature Flags: Client COE Creation and Editing
# Set to 'true' to enable the feature for clients
# Set to 'false' or omit to disable (admin-only)

# Enable/disable client COE creation (default: disabled)
ENABLE_CLIENT_COE_CREATION=false

# Enable/disable client COE editing (default: disabled)
ENABLE_CLIENT_COE_EDITING=false
```

See `docs/MD_files/FEATURE-FLAGS.md` for complete feature flags documentation.
