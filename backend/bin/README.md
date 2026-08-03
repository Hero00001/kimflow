# Local Whisper binary

Place the platform-specific whisper.cpp CLI binary here before packaging:

- Windows: `whisper-cpp.exe`
- macOS/Linux: `whisper-cpp`

The application downloads model files into `~/.kimflow` and resolves this binary from the packaged `backend/bin` directory. Cloud engines do not require this executable.
