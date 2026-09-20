import React from 'react';

export const TestPulseLoader = ({ size = 120, text = 'Cargando Test Pulse Enterprise Suite...' }) => {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '3rem 1.5rem',
      gap: '1.25rem',
      width: '100%',
      minHeight: '380px'
    }}>
      <div style={{
        width: `${size}px`,
        height: `${size}px`,
        position: 'relative',
        filter: 'drop-shadow(0 8px 24px rgba(12, 102, 228, 0.12))'
      }}>
        <svg
          viewBox="0 0 240 240"
          width="100%"
          height="100%"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <linearGradient id="loaderGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#0C66E4" />
              <stop offset="50%" stopColor="#6554C0" />
              <stop offset="100%" stopColor="#8247E5" />
            </linearGradient>
            <linearGradient id="trackGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#E2E8F0" />
              <stop offset="100%" stopColor="#CBD5E1" />
            </linearGradient>
            <filter id="loaderGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* Base Card / Squircle */}
          <rect
            x="20"
            y="20"
            width="200"
            height="200"
            rx="44"
            fill="#FFFFFF"
            stroke="#E2E8F0"
            strokeWidth="2"
          />

          {/* Rotating Outer Progress Arc */}
          <circle
            className="tp-loader-outer-track"
            cx="120"
            cy="120"
            r="88"
            fill="none"
            stroke="url(#loaderGrad)"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray="70 200"
          >
            <animateTransform
              attributeName="transform"
              type="rotate"
              from="0 120 120"
              to="360 120 120"
              dur="3s"
              repeatCount="indefinite"
            />
          </circle>

          {/* Radar Pulse Rings originating from checkmark node (135, 78) */}
          <circle
            className="tp-loader-ring-1"
            cx="135"
            cy="78"
            r="16"
            fill="none"
            stroke="url(#loaderGrad)"
            strokeWidth="2.5"
          >
            <animate attributeName="r" values="10; 45; 70" dur="2.2s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.9; 0.35; 0" dur="2.2s" repeatCount="indefinite" />
          </circle>

          <circle
            className="tp-loader-ring-2"
            cx="135"
            cy="78"
            r="16"
            fill="none"
            stroke="url(#loaderGrad)"
            strokeWidth="1.8"
          >
            <animate attributeName="r" values="10; 45; 70" begin="0.7s" dur="2.2s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.9; 0.35; 0" begin="0.7s" dur="2.2s" repeatCount="indefinite" />
          </circle>

          {/* Static Track Line */}
          <path
            d="M48 120 H74 L94 100 L114 150 L135 78 L155 130 L170 120 H192"
            stroke="#E2E8F0"
            strokeWidth="10"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Animated Pulse Stroke Line running continuously */}
          <path
            className="tp-loader-wave-line"
            d="M48 120 H74 L94 100 L114 150 L135 78 L155 130 L170 120 H192"
            stroke="url(#loaderGrad)"
            strokeWidth="10"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="140"
            filter="url(#loaderGlow)"
          >
            <animate
              attributeName="stroke-dashoffset"
              values="280; -280"
              dur="2s"
              repeatCount="indefinite"
            />
          </path>

          {/* Animated Central Apex Node Beacon */}
          <g className="tp-loader-beacon">
            <circle cx="135" cy="78" r="8" fill="#8247E5">
              <animate attributeName="r" values="7; 9.5; 7" dur="1.8s" repeatCount="indefinite" />
            </circle>
            <circle cx="135" cy="78" r="4.5" fill="#FFFFFF">
              <animate attributeName="r" values="4; 5.5; 4" dur="1.8s" repeatCount="indefinite" />
            </circle>
          </g>
        </svg>
      </div>

      {text && (
        <span style={{
          fontSize: '0.85rem',
          fontWeight: 600,
          color: 'var(--jira-subtle, #626F86)',
          letterSpacing: '-0.01em',
          animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite'
        }}>
          {text}
        </span>
      )}
    </div>
  );
};

export default TestPulseLoader;
