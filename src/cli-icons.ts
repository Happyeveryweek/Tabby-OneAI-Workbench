import { win32 } from 'node:path';

// Brand artwork from OneAI's BrandIcon and Antigravity asset. See THIRD_PARTY_NOTICES.md.
const codexSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
<path fill-rule="evenodd" clip-rule="evenodd" d="M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 00-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 01.476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303l-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 014.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 01-.476 0zm-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71c.286.167.571.167.856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523zm5.899 2.83a5.947 5.947 0 005.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.946-.642 0-1.26.095-1.88.31A5.962 5.962 0 0010.205 0a5.947 5.947 0 00-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1-.19 1.499 0 3.401 2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 004.162 1.713z" fill="#10A37F" />
</svg>`;

const openCodeSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<rect width="512" height="512" rx="96" fill="#1C2333" />
<path d="M320 224V352H192V224H320Z" fill="#38BDF8" />
<path fill-rule="evenodd" clip-rule="evenodd" d="M384 416H128V96H384V416ZM320 160H192V352H320V160Z" fill="#F1ECEC" />
</svg>`;

const piSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="165 165 470 470">
<path fill="#F09082" d="M165.29 165.29H517.36V400H400V282.65H165.29Z" />
<path fill="#4D9ABF" d="M165.29 282.65H282.65V400H400V517.36H282.65V634.72H165.29Z" />
<path fill="#F1BE58" d="M517.36 400H634.72V634.72H517.36Z" />
</svg>`;

const antigravitySvg = `<svg viewBox="0 0 96 96" width="96" height="96" fill="none" xmlns="http://www.w3.org/2000/svg">
<g clip-path="url(#a)">
<path d="M85.973 89.344c5.25 3.937 13.125 1.312 5.907-5.906-21.657-21-17.063-78.75-43.97-78.75-26.905 0-22.312 57.75-43.968 78.75-7.875 7.874.656 9.843 5.906 5.906C30.192 75.563 28.88 51.28 47.911 51.28c19.031 0 17.719 24.282 38.062 38.063Z" fill="#3186FF"/>
<mask id="b" style="mask-type:alpha" maskUnits="userSpaceOnUse" x="0" y="4" width="95" height="88">
<path d="M85.973 89.344c5.25 3.937 13.125 1.312 5.907-5.906-21.657-21-17.063-78.75-43.97-78.75-26.905 0-22.312 57.75-43.968 78.75-7.875 7.874.656 9.843 5.906 5.906C30.192 75.563 28.88 51.28 47.911 51.28c19.031 0 17.719 24.282 38.062 38.063Z" fill="#000"/>
</mask>
<g mask="url(#b)">
<g filter="url(#c)">
<ellipse cx="25.636" cy="30.161" rx="25.636" ry="30.161" transform="rotate(96.476 44.769 9.835)" fill="#FFE432"/>
</g>
<g filter="url(#d)">
<ellipse cx="93.614" cy="23.451" rx="33.188" ry="33.918" transform="rotate(76.924 93.614 23.45)" fill="#FC413D"/>
</g>
<g filter="url(#e)">
<ellipse cx="-4.781" cy="30.81" rx="34.686" ry="44.934" transform="rotate(74.126 -4.78 30.81)" fill="#00B95C"/>
</g>
<g filter="url(#f)">
<ellipse cx="-4.781" cy="30.81" rx="34.686" ry="44.934" transform="rotate(74.126 -4.78 30.81)" fill="#00B95C"/>
</g>
<g filter="url(#g)">
<ellipse cx="-2.314" cy="32.19" rx="33.998" ry="37.428" transform="rotate(45.606 -2.314 32.19)" fill="#00B95C"/>
</g>
<g filter="url(#h)">
<ellipse cx="70.286" cy="101.861" rx="32.645" ry="31.436" transform="rotate(76.924 70.286 101.861)" fill="#3186FF"/>
</g>
<g filter="url(#i)">
<ellipse cx="37.762" cy="39.83" rx="37.762" ry="39.83" transform="rotate(114.176 60.204 15.464)" fill="#FBBC04"/>
</g>
<g filter="url(#j)">
<path d="M-12.05 152.344c-20.676-8.117 14.66-74.901 23.447-97.284 8.787-22.383 32.672-33.948 53.35-25.83 20.677 8.117 45.185 52.825 36.398 75.208C92.358 126.8 8.6 160.461-12.049 152.344Z" fill="#3186FF"/>
</g>
<g filter="url(#k)">
<path d="M113.238 69.22c-5.536 6.462-19.982 3.167-32.266-7.358-12.285-10.525-17.756-24.295-12.22-30.756 5.536-6.46 19.982-3.166 32.266 7.359 12.284 10.525 17.755 24.295 12.22 30.756Z" fill="#749BFF"/>
</g>
<g filter="url(#l)">
<ellipse cx="89.249" cy="10.708" rx="49.771" ry="30.939" transform="rotate(34.076 89.25 10.708)" fill="#FC413D"/>
</g>
<g filter="url(#m)">
<ellipse cx="11.494" cy="17.224" rx="26.671" ry="15.51" transform="rotate(112.516 11.494 17.224)" fill="#FFEE48"/>
</g>
</g>
</g>
<defs>
<filter id="c" x="-12.133" y="-45.923" width="77.726" height="68.909" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
<feFlood flood-opacity="0" result="BackgroundImageFix"/>
<feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape"/>
<feGaussianBlur stdDeviation="4.377" result="effect1_foregroundBlur_6153_71"/>
</filter>
<filter id="d" x="17.408" y="-52.101" width="152.412" height="151.102" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
<feFlood flood-opacity="0" result="BackgroundImageFix"/>
<feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape"/>
<feGaussianBlur stdDeviation="21.159" result="effect1_foregroundBlur_6153_71"/>
</filter>
<filter id="e" x="-85.014" y="-40.729" width="160.467" height="143.078" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
<feFlood flood-opacity="0" result="BackgroundImageFix"/>
<feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape"/>
<feGaussianBlur stdDeviation="17.987" result="effect1_foregroundBlur_6153_71"/>
</filter>
<filter id="f" x="-85.014" y="-40.729" width="160.467" height="143.078" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
<feFlood flood-opacity="0" result="BackgroundImageFix"/>
<feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape"/>
<feGaussianBlur stdDeviation="17.987" result="effect1_foregroundBlur_6153_71"/>
</filter>
<filter id="g" x="-74.079" y="-39.502" width="143.529" height="143.384" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
<feFlood flood-opacity="0" result="BackgroundImageFix"/>
<feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape"/>
<feGaussianBlur stdDeviation="17.987" result="effect1_foregroundBlur_6153_71"/>
</filter>
<filter id="h" x="4.594" y="35.084" width="131.384" height="133.554" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
<feFlood flood-opacity="0" result="BackgroundImageFix"/>
<feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape"/>
<feGaussianBlur stdDeviation="17.093" result="effect1_foregroundBlur_6153_71"/>
</filter>
<filter id="i" x="-23.316" y="-84.096" width="140.966" height="138.215" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
<feFlood flood-opacity="0" result="BackgroundImageFix"/>
<feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape"/>
<feGaussianBlur stdDeviation="15.491" result="effect1_foregroundBlur_6153_71"/>
</filter>
<filter id="j" x="-46.111" y="-1.033" width="176.759" height="182.283" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
<feFlood flood-opacity="0" result="BackgroundImageFix"/>
<feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape"/>
<feGaussianBlur stdDeviation="13.834" result="effect1_foregroundBlur_6153_71"/>
</filter>
<filter id="k" x="41.834" y="3.041" width="98.322" height="94.246" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
<feFlood flood-opacity="0" result="BackgroundImageFix"/>
<feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape"/>
<feGaussianBlur stdDeviation="12.379" result="effect1_foregroundBlur_6153_71"/>
</filter>
<filter id="l" x="23.605" y="-48.077" width="131.289" height="117.57" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
<feFlood flood-opacity="0" result="BackgroundImageFix"/>
<feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape"/>
<feGaussianBlur stdDeviation="10.456" result="effect1_foregroundBlur_6153_71"/>
</filter>
<filter id="m" x="-31.984" y="-34.006" width="86.956" height="102.461" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
<feFlood flood-opacity="0" result="BackgroundImageFix"/>
<feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape"/>
<feGaussianBlur stdDeviation="12.941" result="effect1_foregroundBlur_6153_71"/>
</filter>
<clipPath id="a">
<path fill="#fff" d="M0 0h96v96H0z"/>
</clipPath>
</defs>
</svg>`;

const claudeSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
<path d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z" fill="#D97757" />
</svg>`;

const kimiSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
{/* 右上角 Kimi 品牌标志性电光蓝药丸点 */} <path d="M21.846 0a1.923 1.923 0 110 3.846H20.15a.226.226 0 01-.227-.226V1.923C19.923.861 20.784 0 21.846 0z" fill="#1783FF" /> {/* Kimi 几何 K 主体标 */} <path d="M11.065 11.199l7.257-7.2c.137-.136.06-.41-.116-.41H14.3a.164.164 0 00-.117.051l-7.82 7.756c-.122.12-.302.013-.302-.179V3.82c0-.127-.083-.23-.185-.23H3.186c-.103 0-.186.103-.186.23V19.77c0 .128.083.23.186.23h2.69c.103 0 .186-.102.186-.23v-3.25c0-.069.025-.135.069-.178l2.424-2.406a.158.158 0 01.205-.023l6.484 4.772a7.677 7.677 0 003.453 1.283c.108.012.2-.095.2-.23v-3.06c0-.117-.07-.212-.164-.227a5.028 5.028 0 01-2.027-.807l-5.613-4.064c-.117-.078-.132-.279-.028-.381z" fill="#83a0bc" />
</svg>`;

const grokSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#83a0bc">
<path fill-rule="evenodd" clip-rule="evenodd" d="M9.27 15.29l7.978-5.897c.391-.29.95-.177 1.137.272.98 2.369.542 5.215-1.41 7.169-1.951 1.954-4.667 2.382-7.149 1.406l-2.711 1.257c3.889 2.661 8.611 2.003 11.562-.953 2.341-2.344 3.066-5.539 2.388-8.42l.006.007c-.983-4.232.242-5.924 2.75-9.383.06-.082.12-.164.179-.248l-3.301 3.305v-.01L9.267 15.292M7.623 16.723c-2.792-2.67-2.31-6.801.071-9.184 1.761-1.763 4.647-2.483 7.166-1.425l2.705-1.25a7.808 7.808 0 00-1.829-1A8.975 8.975 0 005.984 5.83c-2.533 2.536-3.33 6.436-1.962 9.764 1.022 2.487-.653 4.246-2.34 6.022-.599.63-1.199 1.259-1.682 1.925l7.62-6.815" />
</svg>`;

const terminalSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
<rect x="2" y="3" width="20" height="18" rx="4" fill="#121820" stroke="#2A3848" stroke-width="1.2" />
<polyline points="6 8 10 12 6 16" stroke="#34D399" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
<line x1="12" y1="16" x2="17" y2="16" stroke="#34D399" stroke-width="2" stroke-linecap="round" />
</svg>`;

const copilotSvg = `<svg fill="#83a0bc" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
<path d="M7.998 15.035c-4.562 0-7.873-2.914-7.998-3.749V9.338c.085-.628.677-1.686 1.588-2.065.013-.07.024-.143.036-.218.029-.183.06-.384.126-.612-.201-.508-.254-1.084-.254-1.656 0-.87.128-1.769.693-2.484.579-.733 1.494-1.124 2.724-1.261 1.206-.134 2.262.034 2.944.765.05.053.096.108.139.165.044-.057.094-.112.143-.165.682-.731 1.738-.899 2.944-.765 1.23.137 2.145.528 2.724 1.261.566.715.693 1.614.693 2.484 0 .572-.053 1.148-.254 1.656.066.228.098.429.126.612.012.076.024.148.037.218.924.385 1.522 1.471 1.591 2.095v1.872c0 .766-3.351 3.795-8.002 3.795Zm0-1.485c2.28 0 4.584-1.11 5.002-1.433V7.862l-.023-.116c-.49.21-1.075.291-1.727.291-1.146 0-2.059-.327-2.71-.991A3.222 3.222 0 0 1 8 6.303a3.24 3.24 0 0 1-.544.743c-.65.664-1.563.991-2.71.991-.652 0-1.236-.081-1.727-.291l-.023.116v4.255c.419.323 2.722 1.433 5.002 1.433ZM6.762 2.83c-.193-.206-.637-.413-1.682-.297-1.019.113-1.479.404-1.713.7-.247.312-.369.789-.369 1.554 0 .793.129 1.171.308 1.371.162.181.519.379 1.442.379.853 0 1.339-.235 1.638-.54.315-.322.527-.827.617-1.553.117-.935-.037-1.395-.241-1.614Zm4.155-.297c-1.044-.116-1.488.091-1.681.297-.204.219-.359.679-.242 1.614.091.726.303 1.231.618 1.553.299.305.784.54 1.638.54.922 0 1.28-.198 1.442-.379.179-.2.308-.578.308-1.371 0-.765-.123-1.242-.37-1.554-.233-.296-.693-.587-1.713-.7Z"/>
<path d="M6.25 9.037a.75.75 0 0 1 .75.75v1.501a.75.75 0 0 1-1.5 0V9.787a.75.75 0 0 1 .75-.75Zm4.25.75v1.501a.75.75 0 0 1-1.5 0V9.787a.75.75 0 0 1 1.5 0Z"/>
</svg>`;

function svgSource(svg: string): string {
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

function iconImage(name: string, source: string): string {
    return `<img class="oneai-cli" width="16" height="16" alt="${name}" src="${source}">`;
}

export const codexIconSource = svgSource(codexSvg.replace('#10A37F', '#000000'));
export const terminalIconSource = svgSource(terminalSvg);

function brand(name: string, executable: string, source: string) {
    return { name, executable, source, icon: iconImage(name, source) };
}

export const supportedCli = [
    brand('Codex', 'codex', codexIconSource),
    brand('OpenCode', 'opencode', svgSource(openCodeSvg)),
    brand('Antigravity', 'agy', svgSource(antigravitySvg)),
    brand('GitHub Copilot', 'copilot', svgSource(copilotSvg)),
    brand('Pi', 'pi', svgSource(piSvg)),
    brand('Claude Code', 'claude', svgSource(claudeSvg)),
    brand('Kimi Code', 'kimi', svgSource(kimiSvg)),
    brand('Grok Build', 'grok', svgSource(grokSvg)),
];

export function cliBrand(executable: string): typeof supportedCli[number] | undefined {
    const name = win32.basename(executable).toLowerCase().replace(/\.(?:exe|cmd|bat|ps1|sh)$/, '');
    if (['pwsh', 'powershell', 'bash'].includes(name)) return systemTerminal;
    return supportedCli.find(cli => cli.executable === (name === 'antigravity' ? 'agy' : name));
}

const systemTerminal = brand('系统终端', 'pwsh', terminalIconSource);

export function cliIcon(executable: string): string { return cliBrand(executable)?.icon ?? 'fas fa-terminal'; }
