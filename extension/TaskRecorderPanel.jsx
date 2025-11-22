import React, { useEffect, useMemo, useState } from 'react';

// Design tokens
const designTokens = {
  background: '#050816',
  surface: 'rgba(15, 23, 42, 0.75)',
  surfaceStrong: 'rgba(15, 23, 42, 0.95)',
  accent: '#38BDF8',
  accentSoft: 'rgba(56, 189, 248, 0.16)',
  borderSubtle: 'rgba(148, 163, 184, 0.35)',
  textPrimary: '#E5E7EB',
  textSecondary: '#9CA3AF',
  textMuted: '#6B7280',
  error: '#F97373',
  radiusMain: '16px',
  radiusControl: '12px',
  shadow: '0 18px 45px rgba(15, 23, 42, 0.6)',
  blur: 'blur(16px)'
};

const formatTime = (seconds) => {
  const mins = Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0');
  const secs = Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0');
  return `${mins}:${secs}`;
};

const TaskRecorderPanel = () => {
  const [status, setStatus] = useState('idle');
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (status !== 'recording') {
      return undefined;
    }

    const start = Date.now() - elapsed * 1000;
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);

    return () => clearInterval(interval);
  }, [status]);

  const buttonStates = useMemo(
    () => ({
      start: status === 'idle' || status === 'finished',
      stop: status === 'recording',
      push: status === 'finished'
    }),
    [status]
  );

  const handleStart = () => {
    if (!buttonStates.start) return;
    setStatus('recording');
    setElapsed(0);
  };

  const handleStop = () => {
    if (!buttonStates.stop) return;
    setStatus('finished');
  };

  const handlePush = () => {
    if (!buttonStates.push) return;
    alert('Pushing task to MongoDB (stub)');
  };

  return (
    <div
      style={{
        backgroundColor: designTokens.background,
        borderLeft: '1px solid rgba(255,255,255,0.05)',
        width: '100%',
        minWidth: 320,
        maxWidth: 360,
        minHeight: '100%',
        padding: 16,
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        color: designTokens.textPrimary
      }}
    >
      <div
        style={{
          backgroundColor: designTokens.surface,
          borderColor: designTokens.borderSubtle,
          borderRadius: designTokens.radiusMain,
          borderStyle: 'solid',
          borderWidth: 1,
          padding: 20,
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
          boxShadow: designTokens.shadow,
          backdropFilter: designTokens.blur
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12
          }}
        >
          <div>
            <div
              style={{
                fontSize: 11,
                textTransform: 'uppercase',
                letterSpacing: '0.18em',
                color: designTokens.textSecondary,
                marginBottom: 4
              }}
            >
              Capture every click
            </div>
            <h1
              style={{
                color: designTokens.textPrimary,
                fontSize: 20,
                fontWeight: 600,
                margin: 0,
                lineHeight: 1.15
              }}
            >
              Task Recorder
            </h1>
            <p
              style={{
                fontSize: 13,
                marginTop: 6,
                color: designTokens.textSecondary,
                maxWidth: 260
              }}
            >
              Capture every click and keystroke. Review your tasks in one place.
            </p>
          </div>
          <button
            style={{
              color: designTokens.textPrimary,
              borderColor: 'rgba(255,255,255,0.18)',
              backgroundColor: 'rgba(15,23,42,0.9)',
              fontSize: 11,
              padding: '4px 10px',
              borderRadius: 999,
              borderStyle: 'solid',
              borderWidth: 1,
              cursor: 'pointer',
              whiteSpace: 'nowrap'
            }}
          >
            View
          </button>
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8
          }}
        >
          <label
            style={{
              fontSize: 12,
              fontWeight: 500,
              textTransform: 'uppercase',
              letterSpacing: '0.16em',
              color: designTokens.textSecondary
            }}
          >
            Task title
          </label>
          <input
            type="text"
            defaultValue=""
            placeholder="Name this task before you start recording"
            style={{
              width: '100%',
              padding: '10px 14px',
              borderRadius: designTokens.radiusControl,
              borderColor: 'rgba(255,255,255,0.1)',
              borderWidth: 1,
              borderStyle: 'solid',
              backgroundColor: 'rgba(255,255,255,0.05)',
              color: designTokens.textPrimary,
              fontSize: 13,
              boxSizing: 'border-box'
            }}
          />
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: 4
          }}
        >
          <span
            style={{
              fontSize: 11,
              textTransform: 'uppercase',
              letterSpacing: '0.18em',
              color: designTokens.textMuted
            }}
          >
            Duration
          </span>
          <span
            style={{
              fontSize: 18,
              fontWeight: 600,
              color: designTokens.textPrimary,
              padding: '4px 10px',
              borderRadius: 999,
              borderColor: 'rgba(255,255,255,0.1)',
              borderWidth: 1,
              borderStyle: 'solid',
              backgroundColor: 'rgba(255,255,255,0.05)'
            }}
          >
            {formatTime(elapsed)}
          </span>
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            marginTop: 12
          }}
        >
          <button
            style={{
              backgroundColor: '#16A34A',
              opacity: buttonStates.start ? 1 : 0.4,
              width: '100%',
              height: 44,
              borderRadius: designTokens.radiusControl,
              border: 'none',
              color: '#022c22',
              fontSize: 14,
              fontWeight: 600,
              boxShadow: '0 12px 30px rgba(56,189,248,0.35)',
              cursor: buttonStates.start ? 'pointer' : 'default'
            }}
            disabled={!buttonStates.start}
            onClick={handleStart}
          >
            Start Recording
          </button>
          <button
            style={{
              backgroundColor: '#B91C1C',
              borderColor: designTokens.borderSubtle,
              borderWidth: 1,
              borderStyle: 'solid',
              opacity: buttonStates.stop ? 1 : 0.4,
              width: '100%',
              height: 44,
              borderRadius: designTokens.radiusControl,
              color: '#FEF2F2',
              fontSize: 14,
              fontWeight: 600,
              cursor: buttonStates.stop ? 'pointer' : 'default'
            }}
            disabled={!buttonStates.stop}
            onClick={handleStop}
          >
            Stop Recording
          </button>
          <button
            style={{
              backgroundColor: designTokens.surfaceStrong,
              borderColor: designTokens.borderSubtle,
              borderWidth: 1,
              borderStyle: 'solid',
              opacity: buttonStates.push ? 1 : 0.4,
              width: '100%',
              height: 44,
              borderRadius: designTokens.radiusControl,
              color: designTokens.textPrimary,
              fontSize: 14,
              fontWeight: 500,
              cursor: buttonStates.push ? 'pointer' : 'default'
            }}
            disabled={!buttonStates.push}
            onClick={handlePush}
          >
            Sync to MongoDB
          </button>
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            marginTop: 8
          }}
        >
          <p
            style={{
              fontSize: 12,
              fontWeight: 500,
              textTransform: 'uppercase',
              letterSpacing: '0.16em',
              color: designTokens.textSecondary
            }}
          >
            Final Output
          </p>
          <div
            style={{
              borderColor: designTokens.borderSubtle,
              borderWidth: 1,
              borderStyle: 'dashed',
              backgroundColor: 'rgba(255,255,255,0.04)',
              borderRadius: 14,
              padding: '12px 10px',
              fontSize: 12,
              color: designTokens.textMuted,
              textAlign: 'center'
            }}
          >
            {status === 'finished' ? 'Latest task ready' : 'No tasks yet'}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TaskRecorderPanel;
