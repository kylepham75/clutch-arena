export function OrbitArt() {
  return (
    <svg
      className="orbit-art"
      viewBox="0 0 510 310"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          id="planet"
          x1="170"
          y1="70"
          x2="365"
          y2="240"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#ffb88c" />
          <stop offset=".48" stopColor="#f46b43" />
          <stop offset="1" stopColor="#7b3226" />
        </linearGradient>
        <linearGradient id="rocket" x1="300" y1="70" x2="359" y2="158">
          <stop stopColor="#fff9e9" />
          <stop offset="1" stopColor="#bdb8aa" />
        </linearGradient>
        <radialGradient id="glow">
          <stop stopColor="#f66b3e" stopOpacity=".22" />
          <stop offset="1" stopColor="#f66b3e" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="285" cy="160" r="165" fill="url(#glow)" />
      <g stroke="#fff" strokeOpacity=".09">
        <ellipse
          cx="287"
          cy="169"
          rx="195"
          ry="76"
          transform="rotate(-28 287 169)"
        />
        <ellipse
          cx="287"
          cy="169"
          rx="228"
          ry="105"
          transform="rotate(-28 287 169)"
        />
        <ellipse
          cx="287"
          cy="169"
          rx="152"
          ry="53"
          transform="rotate(-28 287 169)"
        />
      </g>
      <circle cx="282" cy="162" r="79" fill="url(#planet)" />
      <path
        d="M216 119c35-5 53 10 81 7s38-14 44-18M205 157c41-14 62 20 100 17s42-10 56-6M221 208c26-10 63 11 89 9"
        stroke="#ffca9b"
        strokeWidth="9"
        opacity=".12"
      />
      <path
        d="M154 207c-3 22 57 17 129-13s133-68 121-83c-6-8-23-6-48 0"
        stroke="#eaaa7c"
        strokeWidth="8"
      />
      <path
        d="M154 207c-3 22 57 17 129-13s133-68 121-83"
        stroke="#ffc895"
        strokeWidth="2"
      />
      <g transform="translate(327 54) rotate(31)">
        <path d="M7 82-1 113l17-11 16 8-6-31" fill="#ed7449" />
        <path d="M10 85 15 117 24 85" fill="#ffcb70" />
        <path d="M4 45-12 68-11 83 8 75M28 45l17 22 1 16-20-8" fill="#e56f4d" />
        <path
          d="M16 0C-3 22-3 54 5 83h23C36 53 35 23 16 0Z"
          fill="url(#rocket)"
        />
        <path d="M16 0C8 9 5 16 3 23h26C26 15 22 8 16 0Z" fill="#f27650" />
        <circle cx="16" cy="43" r="10" fill="#858c89" />
        <circle cx="16" cy="43" r="7" fill="#253d40" />
        <path
          d="M11 39c1-3 4-4 7-3"
          stroke="#b9d9cd"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path
          d="M16 65v27"
          stroke="#f07852"
          strokeWidth="6"
          strokeLinecap="round"
        />
      </g>
      <g fill="#eee7d9">
        <circle cx="163" cy="72" r="2" />
        <circle cx="433" cy="218" r="2" />
        <circle cx="409" cy="55" r="1.5" />
        <circle cx="174" cy="268" r="1.5" />
        <circle cx="455" cy="131" r="1" />
        <circle cx="240" cy="38" r="1" />
        <path d="m142 146 2-6 2 6 6 2-6 2-2 6-2-6-6-2Z" />
        <path d="m385 261 2-5 2 5 5 2-5 2-2 5-2-5-5-2Z" />
      </g>
      <rect
        x="352"
        y="204"
        width="100"
        height="33"
        rx="16.5"
        transform="rotate(-8 352 204)"
        fill="#383a33"
        stroke="#606055"
      />
      <text
        x="367"
        y="224"
        fill="#ebdfca"
        fontSize="10"
        fontFamily="sans-serif"
        transform="rotate(-8 352 204)"
      >
        ✦ LOCKED IN
      </text>
    </svg>
  );
}
export function SoloArt() {
  return (
    <div className="mode-art solo-art" aria-hidden="true">
      <div className="art-orbit" />
      <div className="bolt-shape">ϟ</div>
      <span className="art-spark s1">✦</span>
      <span className="art-spark s2">+</span>
      <span className="art-spark s3">✦</span>
    </div>
  );
}
export function ArenaArt() {
  return (
    <div className="mode-art arena-art" aria-hidden="true">
      <div className="arena-tile t1">✦</div>
      <div className="arena-tile t2">⚑</div>
      <div className="arena-tile t3">ϟ</div>
      <span className="art-spark s1">+</span>
      <span className="art-spark s3">✦</span>
    </div>
  );
}
