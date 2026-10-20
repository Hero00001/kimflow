# 12 — Any device-list change pauses an active recording

Status: ready-for-agent
Type: task
Blocked by: none

Severity: MEDIUM

## Context

`src/audio/recorder.ts:209-223`

The `devicechange` handler cannot distinguish "my microphone was unplugged" from "some other device appeared", and pauses whenever the capture is recording.

## Failure scenario

Plugging in a USB headset, a webcam or a Bluetooth speaker mid-dictation pauses the recording for no reason.

## Suggested fix

Compare the device list before and after, and pause only when the active device actually disappeared.

## Test direction

A recorder test that fires `devicechange` with an added (not removed) device.

## Comments
