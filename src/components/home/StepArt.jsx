import { cn } from "@/lib/utils/cn";

/**
 * Flat-vector scene kit for the step cards (§12, §30).
 *
 * Every scene is drawn on the same 320×210 stage, over the same blue blob and
 * the same desk line, from the same handful of primitives below — so four
 * cards in a row read as one illustration set rather than four clip-art picks.
 *
 * Colours are literal hex on purpose: these are artwork fills, not UI
 * surfaces, and each one is sampled from the tokens in `globals.css`
 * (brand / accent / plum / success) so the art cannot drift from the palette.
 */
const C = {
  blob: "#dfe9ff",
  line: "#2348d6",
  soft: "#bcd3ff",
  softer: "#dbe6ff",
  shirt: "#598eff",
  shirtDeep: "#3366f2",
  shirtPlum: "#bf82e3",
  skin: "#eab793",
  skinDeep: "#c98a60",
  hair: "#141f42",
  hairWarm: "#3b2a4d",
  white: "#ffffff",
  accent: "#fe7b12",
  accentSoft: "#ffdaa8",
  green: "#2fae76",
  greenDeep: "#1f8f5d",
  plum: "#a455d2",
};

const BLOB =
  "M46 108C30 70 58 30 102 30c32 0 44 14 74 10 34-4 62-20 88 0 28 22 24 68 0 92-26 26-78 20-118 22-46 2-84-8-100-46Z";

/* --- primitives ---------------------------------------------------------- */

function Blob({ flip = false }) {
  return (
    <path d={BLOB} fill={C.blob} transform={flip ? "translate(320,0) scale(-1,1)" : undefined} />
  );
}

function Desk() {
  return <rect x="34" y="168" width="252" height="5" rx="2.5" fill={C.line} />;
}

/**
 * A seated figure, head centred on (x, y) and shoulders running down to the
 * desk. `long` gives shoulder-length hair; `flip` turns them around.
 */
function Figure({ x, y, shirt = C.shirt, skin = C.skin, hair = C.hair, long = false, flip = false }) {
  const foot = 168 - y; // torso always lands exactly on the desk line

  return (
    <g transform={`translate(${x},${y})${flip ? " scale(-1,1)" : ""}`}>
      {long && <path d="M-21 0a21 21 0 0 1 42 0v28a21 21 0 0 1-42 0Z" fill={hair} />}
      <path
        d={`M-30 ${foot}C-30 ${foot * 0.5} -17 22 0 22S30 ${foot * 0.5} 30 ${foot}Z`}
        fill={shirt}
      />
      <circle cx="0" cy="0" r="17" fill={skin} />
      {/* Long hair already frames the crown; a second cap over it buried the face. */}
      {!long && <path d="M-17 1A17 17 0 0 1 17 1Z" fill={hair} />}
    </g>
  );
}

/** An arm, drawn as one stroked curve so it keeps the flat-line look. */
function Arm({ d, skin = C.skin, hand }) {
  return (
    <g>
      <path d={d} stroke={skin} strokeWidth="9" strokeLinecap="round" fill="none" />
      {hand && <circle cx={hand[0]} cy={hand[1]} r="6" fill={skin} />}
    </g>
  );
}

/** The recurring white UI panel of the set. */
function Panel({ x = 0, y = 0, w, h, bar = true, children }) {
  return (
    <g transform={`translate(${x},${y})`}>
      <rect width={w} height={h} rx="7" fill={C.white} stroke={C.line} strokeWidth="3" />
      {bar && (
        <>
          <circle cx="13" cy="13" r="3" fill={C.soft} />
          <circle cx="23" cy="13" r="3" fill={C.soft} />
          <circle cx="33" cy="13" r="3" fill={C.soft} />
        </>
      )}
      {children}
    </g>
  );
}

function Line({ x, y, w, h = 5, fill = C.softer }) {
  return <rect x={x} y={y} width={w} height={h} rx={h / 2} fill={fill} />;
}

function Plant({ x, y = 168, scale = 1, flip = false }) {
  return (
    <g transform={`translate(${x},${y}) scale(${flip ? -scale : scale},${scale})`}>
      <path d="M-14 0-18-27h36L14 0Z" fill={C.accentSoft} />
      <rect x="-20" y="-33" width="40" height="8" rx="4" fill={C.accent} />
      <rect x="-1.5" y="-64" width="3" height="31" rx="1.5" fill={C.greenDeep} />
      <path d="M0-34C-17-43-21-61-11-73c11 7 15 27 11 39Z" fill={C.green} />
      <path d="M2-36C16-43 24-60 15-72 3-65-2-48 2-36Z" fill={C.greenDeep} />
    </g>
  );
}

function Bubble({ x, y, w = 58, h = 30, tail = "left", fill = C.white, lines = C.soft }) {
  return (
    <g transform={`translate(${x},${y})`}>
      <rect width={w} height={h} rx="9" fill={fill} stroke={C.line} strokeWidth="2.5" />
      <path
        d={tail === "left" ? `M12 ${h - 1}v10l15-10Z` : `M${w - 12} ${h - 1}v10l-15-10Z`}
        fill={fill}
        stroke={C.line}
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <Line x={13} y={h / 2 - 7} w={w - 26} h={4} fill={lines} />
      <Line x={13} y={h / 2 + 2} w={w - 38} h={4} fill={lines} />
    </g>
  );
}

function CheckBadge({ x, y, r = 16, fill = C.green }) {
  return (
    <g transform={`translate(${x},${y})`}>
      <circle cx="0" cy="0" r={r} fill={fill} />
      <path
        d={`M${(-r * 0.42).toFixed(1)} 0 ${(-r * 0.08).toFixed(1)} ${(r * 0.32).toFixed(1)} ${(r * 0.46).toFixed(1)} ${(-r * 0.36).toFixed(1)}`}
        fill="none"
        stroke={C.white}
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>
  );
}

/** A desktop screen on a stand, sitting on the desk line. */
function Monitor({ x = 176, children }) {
  return (
    <g>
      <rect x={x + 38} y="152" width="16" height="12" fill={C.line} />
      <rect x={x + 16} y="162" width="60" height="6" rx="3" fill={C.line} />
      <Panel x={x} y={90} w={92} h={62}>
        {children}
      </Panel>
    </g>
  );
}

function Mug({ x, y = 152 }) {
  return (
    <g transform={`translate(${x},${y})`}>
      <path
        d="M20 4h3a5 5 0 0 1 0 10h-3"
        fill="none"
        stroke={C.line}
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <rect width="20" height="16" rx="4" fill={C.white} stroke={C.line} strokeWidth="2.5" />
      <rect x="4" y="6" width="12" height="4" rx="2" fill={C.accent} />
    </g>
  );
}

function Keyboard({ x, y = 160, w = 54 }) {
  return (
    <rect x={x} y={y} width={w} height="8" rx="4" fill={C.white} stroke={C.line} strokeWidth="2.5" />
  );
}

/* --- scenes -------------------------------------------------------------- */

/** 1 — Search: a course search running on the desktop. */
function SearchScene() {
  return (
    <>
      <Blob />
      <Plant x={62} scale={0.9} />
      <Monitor>
        <Line x={13} y={26} w={40} />
        <rect x="13" y="36" width="66" height="15" rx="7.5" fill={C.softer} />
        <g transform="translate(60,43.5)">
          <circle cx="0" cy="0" r="8" fill="none" stroke={C.accent} strokeWidth="3.2" />
          <path d="m5.8 5.8 6.4 6.4" stroke={C.accent} strokeWidth="3.2" strokeLinecap="round" />
        </g>
      </Monitor>
      <Panel x={70} y={40} w={74} h={34} bar={false}>
        <Line x={12} y={11} w={30} h={5} fill={C.soft} />
        <Line x={12} y={21} w={46} h={5} />
      </Panel>
      <Desk />
      <Figure x={132} y={100} />
      <Keyboard x={140} y={158} w={56} />
      <Arm d="M152 132c16 6 22 15 22 24" hand={[174, 154]} />
    </>
  );
}

/** 2 — Message: comparing tutors and messaging them from a phone. */
function MessageScene() {
  return (
    <>
      <Blob flip />
      <Bubble x={40} y={44} w={72} h={32} />
      <Bubble x={64} y={92} w={58} h={28} tail="right" fill={C.softer} lines={C.white} />
      <Plant x={262} scale={0.85} />
      <Desk />
      <Figure x={168} y={96} shirt={C.shirtDeep} long hair={C.hairWarm} skin={C.skinDeep} />
      <Arm d="M150 128c-14 6-20 14-20 26" skin={C.skinDeep} hand={[130, 152]} />
      <g transform="rotate(-9 128 146)">
        <rect
          x="112"
          y="126"
          width="30"
          height="44"
          rx="6"
          fill={C.white}
          stroke={C.line}
          strokeWidth="3"
        />
        <Line x={118} y={134} w={18} h={4} fill={C.soft} />
        <Line x={118} y={143} w={13} h={4} />
        <Line x={118} y={152} w={18} h={4} fill={C.soft} />
      </g>
      <rect x="196" y="156" width="46" height="7" rx="3.5" fill={C.plum} />
      <rect x="200" y="147" width="38" height="7" rx="3.5" fill={C.accent} />
    </>
  );
}

/** 3 — Book: a slot picked off a live calendar. */
function CalendarScene() {
  return (
    <>
      <Blob />
      <Plant x={38} scale={0.66} />
      <Desk />
      <g transform="translate(120,36)">
        <rect
          width="118"
          height="104"
          rx="9"
          fill={C.white}
          stroke={C.line}
          strokeWidth="3"
        />
        <path d="M1.5 24h115" stroke={C.line} strokeWidth="3" />
        <rect x="26" y="-7" width="7" height="16" rx="3.5" fill={C.line} />
        <rect x="85" y="-7" width="7" height="16" rx="3.5" fill={C.line} />
        {[0, 1, 2].map((row) =>
          [0, 1, 2, 3].map((col) => {
            const picked = row === 1 && col === 2;
            return (
              <rect
                key={`${row}-${col}`}
                x={14 + col * 24}
                y={36 + row * 22}
                width="18"
                height="14"
                rx="4"
                fill={picked ? C.accent : C.softer}
              />
            );
          }),
        )}
      </g>
      <CheckBadge x={240} y={48} r={17} />
      <Figure x={80} y={106} shirt={C.shirtDeep} />
      <Arm d="M96 134c14 2 22 8 26 18" hand={[122, 152]} />
      <rect x="232" y="158" width="48" height="10" rx="3" fill={C.plum} />
      <rect x="238" y="150" width="36" height="8" rx="3" fill={C.accentSoft} />
    </>
  );
}

/** 4 — Progress: results rising, lesson history in one place. */
function ProgressScene() {
  return (
    <>
      <Blob flip />
      <Monitor x={52}>
        <g transform="translate(0,4)">
          {[
            { x: 14, h: 16 },
            { x: 32, h: 26 },
            { x: 50, h: 34 },
            { x: 68, h: 44 },
          ].map((bar, i) => (
            <rect
              key={bar.x}
              x={bar.x}
              y={52 - bar.h}
              width="11"
              height={bar.h}
              rx="4"
              fill={i === 3 ? C.accent : C.soft}
            />
          ))}
        </g>
      </Monitor>
      <path
        d="M66 116c22-6 36 4 52-14s28-22 46-30"
        fill="none"
        stroke={C.greenDeep}
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray="0.1 9"
      />
      <CheckBadge x={224} y={58} r={18} />
      <Desk />
      <Mug x={150} />
      <Figure x={228} y={106} shirt={C.shirtPlum} skin={C.skinDeep} flip />
      <Arm d="M212 134c-16 3-24 10-26 22" skin={C.skinDeep} hand={[186, 154]} />
      <Plant x={288} scale={0.7} flip />
    </>
  );
}

/** 5 — Apply: the tutor application, filled in step by step. */
function ApplyScene() {
  return (
    <>
      <Blob />
      <Plant x={46} scale={0.72} />
      <Desk />
      <g transform="rotate(-4 176 96)">
        <rect
          x="132"
          y="40"
          width="96"
          height="112"
          rx="8"
          fill={C.white}
          stroke={C.line}
          strokeWidth="3"
        />
        <Line x={148} y={60} w={44} h={6} fill={C.soft} />
        <Line x={148} y={78} w={64} h={5} />
        <Line x={148} y={92} w={52} h={5} />
        <rect x="148" y="108" width="14" height="14" rx="4" fill={C.green} />
        <Line x={170} y={112} w={42} h={6} />
        <rect x="148" y="130" width="14" height="14" rx="4" fill={C.accentSoft} />
        <Line x={170} y={134} w={30} h={6} />
      </g>
      <g transform="rotate(38 244 118)">
        <rect x="238" y="82" width="12" height="52" rx="5" fill={C.accent} />
        <path d="M238 134h12l-6 14Z" fill={C.hair} />
      </g>
      <Figure x={84} y={104} shirt={C.shirtDeep} />
      <Arm d="M100 132c16 2 26 10 30 22" hand={[130, 152]} />
    </>
  );
}

/** 6 — Verify: documents checked before a profile is ever visible. */
function VerifyScene() {
  return (
    <>
      <Blob flip />
      <Panel x={46} y={62} w={82} h={92} bar={false}>
        <Line x={16} y={18} w={40} h={6} fill={C.soft} />
        <Line x={16} y={34} w={50} h={5} />
        <Line x={16} y={46} w={36} h={5} />
        <Line x={16} y={58} w={46} h={5} />
        <rect x="16" y="70" width="22" height="8" rx="4" fill={C.accentSoft} />
      </Panel>
      <g transform="translate(180,96)">
        <path
          d="M0-52 46-36v34C46 24 26 42 0 52-26 42-46 24-46-2v-34Z"
          fill={C.shirtDeep}
        />
        <path
          d="M-19 2 -5 16 20-12"
          fill="none"
          stroke={C.white}
          strokeWidth="8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
      <Desk />
      <Plant x={272} scale={0.8} flip />
      <CheckBadge x={128} y={58} r={15} fill={C.accent} />
    </>
  );
}

/** 7 — Teach: an online lesson in progress. */
function TeachScene() {
  return (
    <>
      <Blob />
      <Plant x={56} scale={0.8} />
      <Desk />
      <g>
        <rect x="112" y="46" width="124" height="86" rx="8" fill={C.white} stroke={C.line} strokeWidth="3" />
        <rect x="124" y="58" width="48" height="36" rx="6" fill={C.softer} />
        <circle cx="148" cy="72" r="8" fill={C.shirt} />
        <path d="M136 94c2-9 6-13 12-13s10 4 12 13Z" fill={C.shirt} />
        <rect x="180" y="58" width="44" height="36" rx="6" fill={C.softer} />
        <circle cx="202" cy="72" r="8" fill={C.plum} />
        <path d="M190 94c2-9 6-13 12-13s10 4 12 13Z" fill={C.plum} />
        <rect x="124" y="104" width="62" height="6" rx="3" fill={C.soft} />
        <rect x="124" y="116" width="40" height="6" rx="3" fill={C.softer} />
        <circle cx="216" cy="114" r="11" fill={C.green} />
        <path d="M212 114h8m-4-4v8" stroke={C.white} strokeWidth="2.6" strokeLinecap="round" />
      </g>
      <path d="M96 132h156l16 36H80Z" fill={C.white} stroke={C.line} strokeWidth="3" strokeLinejoin="round" />
      <rect x="124" y="142" width="100" height="10" rx="5" fill={C.softer} />
      <CheckBadge x={256} y={62} r={15} fill={C.accent} />
    </>
  );
}

/**
 * 8 and 9 — Online and in person. Deliberately a matched pair: same stage,
 * same seated figure at the same scale, same desk. Only the place changes,
 * which is the entire point of the section they sit in.
 */
function OnlineScene() {
  return (
    <>
      <Blob />
      <Plant x={34} scale={0.62} />

      {/* the tutor, live on screen */}
      <g>
        <rect
          x="150"
          y="48"
          width="126"
          height="92"
          rx="9"
          fill={C.white}
          stroke={C.line}
          strokeWidth="3"
        />
        <rect x="162" y="60" width="102" height="52" rx="6" fill={C.softer} />
        <g transform="translate(213,92)">
          <path d="M-21 20C-21 5-12-3 0-3S21 5 21 20Z" fill={C.shirtPlum} />
          <circle cx="0" cy="-14" r="12" fill={C.skinDeep} />
          <path d="M-12-13A12 12 0 0 1 12-13Z" fill={C.hairWarm} />
        </g>
        {/* the learner's own tile, tucked into the corner */}
        <rect x="236" y="66" width="22" height="18" rx="4" fill={C.soft} />
        <circle cx="247" cy="72" r="3.4" fill={C.white} />
        <path d="M241 82c1-4 3-6 6-6s5 2 6 6Z" fill={C.white} />
        {/* call controls */}
        <rect x="162" y="120" width="16" height="12" rx="6" fill={C.soft} />
        <rect x="184" y="120" width="16" height="12" rx="6" fill={C.soft} />
        <rect x="206" y="120" width="24" height="12" rx="6" fill={C.accent} />
      </g>
      <rect x="205" y="140" width="16" height="20" fill={C.line} />
      <rect x="183" y="160" width="60" height="7" rx="3.5" fill={C.line} />

      {/* the connection itself */}
      <g
        transform="translate(126,76)"
        fill="none"
        stroke={C.accent}
        strokeWidth="3.2"
        strokeLinecap="round"
      >
        <circle cx="0" cy="0" r="2.8" fill={C.accent} stroke="none" />
        <path d="M-7-6a10 10 0 0 1 14 0" />
        <path d="M-13-13a20 20 0 0 1 26 0" />
      </g>

      <Desk />
      <Keyboard x={116} y={158} w={50} />
      <Figure x={84} y={104} shirt={C.shirtDeep} />
      <Arm d="M100 132c18 4 30 11 34 21" hand={[134, 153]} />
    </>
  );
}

function InPersonScene() {
  return (
    <>
      <Blob flip />
      <Plant x={286} scale={0.66} flip />

      {/* the pin stands for the place you agreed on, not an address */}
      <g transform="translate(160,50) scale(0.85)">
        <path d="M0-30c-12 0-21 9-21 21 0 15 21 35 21 35s21-20 21-35c0-12-9-21-21-21Z" fill={C.accent} />
        <circle cx="0" cy="-9" r="8" fill={C.white} />
      </g>

      <Desk />

      {/* one book, open on the table between the two of them */}
      <g>
        <path
          d="M160 168 118 158v-18l42 10Z"
          fill={C.white}
          stroke={C.line}
          strokeWidth="2.6"
          strokeLinejoin="round"
        />
        <path
          d="M160 168l42-10v-18l-42 10Z"
          fill={C.white}
          stroke={C.line}
          strokeWidth="2.6"
          strokeLinejoin="round"
        />
        <g transform="rotate(13 139 154)">
          <Line x={124} y={149} w={28} h={3.5} fill={C.soft} />
          <Line x={124} y={157} w={19} h={3.5} />
        </g>
        <g transform="rotate(-13 181 154)">
          <Line x={168} y={149} w={28} h={3.5} fill={C.soft} />
          <Line x={177} y={157} w={19} h={3.5} />
        </g>
      </g>

      <Figure x={86} y={104} shirt={C.shirtDeep} />
      <Arm d="M102 132c10 5 16 11 18 20" hand={[120, 152]} />
      <Figure x={234} y={104} shirt={C.shirtPlum} skin={C.skinDeep} hair={C.hairWarm} long />
      <Arm d="M218 132c-10 5-16 11-18 20" skin={C.skinDeep} hand={[200, 152]} />
    </>
  );
}

/**
 * 10 — Decide: approve, reject or ask for more. The two chips are the whole
 * point of the scene, so they sit on their own above the desk rather than
 * inside the document panel.
 */
function DecideScene() {
  return (
    <>
      <Blob flip />
      <Plant x={46} scale={0.7} />

      {/* the application, open for review */}
      <Panel x={62} y={50} w={98} h={100} bar={false}>
        <circle cx="26" cy="28" r="11" fill={C.softer} />
        <Line x={44} y={20} w={38} h={6} fill={C.soft} />
        <Line x={44} y={32} w={26} h={5} />
        <Line x={16} y={54} w={66} h={5} />
        <Line x={16} y={66} w={50} h={5} />
        <rect x="16" y="80" width="28" height="9" rx="4.5" fill={C.accentSoft} />
        <rect x="50" y="80" width="32" height="9" rx="4.5" fill={C.softer} />
      </Panel>

      {/* the decision itself */}
      <CheckBadge x={182} y={62} r={17} />
      <g transform="translate(182,110)">
        <circle cx="0" cy="0" r="14" fill={C.accent} />
        <path d="M-5-5 5 5M5-5-5 5" stroke={C.white} strokeWidth="3.4" strokeLinecap="round" />
      </g>

      <Desk />
      <Mug x={166} />
      <Figure x={252} y={104} shirt={C.shirtPlum} skin={C.skinDeep} hair={C.hairWarm} long flip />
      <Arm d="M236 132c-18 4-28 11-30 22" skin={C.skinDeep} hand={[206, 154]} />
    </>
  );
}

/** 11 — Live: the approved profile, showing only the badges it earned. */
function LiveScene() {
  return (
    <>
      <Blob />
      <Plant x={52} scale={0.72} />

      {/* the profile card, exactly as a family meets it in search */}
      <Panel x={94} y={38} w={122} h={92} bar={false}>
        <circle cx="30" cy="32" r="17" fill={C.softer} />
        <circle cx="30" cy="27" r="7" fill={C.shirt} />
        <path d="M18 44c2-8 6-12 12-12s10 4 12 12Z" fill={C.shirt} />
        <Line x={58} y={18} w={48} h={7} fill={C.soft} />
        <Line x={58} y={32} w={32} h={5} />
        <rect x="58" y="44" width="24" height="10" rx="5" fill={C.green} />
        <rect x="86" y="44" width="18" height="10" rx="5" fill={C.plum} />
        <Line x={16} y={66} w={90} h={5} />
        <rect x="16" y="76" width="38" height="11" rx="5.5" fill={C.accent} />
      </Panel>
      <CheckBadge x={216} y={44} r={16} />

      <Desk />
      <Mug x={68} />
      <Keyboard x={196} y={158} w={52} />
      <Figure x={244} y={104} shirt={C.shirtDeep} flip />
      <Arm d="M228 132c-18 5-30 12-34 22" hand={[194, 153]} />
    </>
  );
}

const SCENES = {
  search: SearchScene,
  message: MessageScene,
  calendar: CalendarScene,
  progress: ProgressScene,
  apply: ApplyScene,
  verify: VerifyScene,
  teach: TeachScene,
  online: OnlineScene,
  inperson: InPersonScene,
  decide: DecideScene,
  live: LiveScene,
};

/**
 * Decorative only — every scene sits directly above the step's own heading and
 * body copy, so it is hidden from assistive tech rather than described twice.
 */
export function StepArt({ name, className }) {
  const Scene = SCENES[name] ?? SearchScene;

  return (
    <svg
      viewBox="6 8 308 182"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={cn("h-auto w-full", className)}
    >
      <Scene />
    </svg>
  );
}
