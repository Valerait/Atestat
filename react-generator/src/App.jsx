// ════════════════════════════════════════════════════════════════
//  Генератор Аттестатов — React (Atestat 2026)
//  Design: warm off-white / teal — claude.ai/design
// ════════════════════════════════════════════════════════════════
import { useState, useRef, useCallback, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import JSZip from 'jszip'
import './App.css'

// ─────────────────────────────────────────────
// КОНСТАНТЫ
// ─────────────────────────────────────────────
const PAGE_W = 841.89   // pt — A4 Landscape ширина
const PAGE_H = 595.28   // pt — A4 Landscape высота
const MM     = 2.835432 // 1 мм в pt
const LS     = 12       // line-spacing pt (grades)

// ─────────────────────────────────────────────
// УТИЛИТЫ ОЦЕНОК
// ─────────────────────────────────────────────
function getGradeInfo(rawScore) {
  const s = parseFloat(rawScore)
  if (isNaN(s)) return { letter: 'сын', point: '' }
  if (s >= 95)  return { letter: 'A',  point: '4.0'  }
  if (s >= 90)  return { letter: 'A-', point: '3.67' }
  if (s >= 85)  return { letter: 'B+', point: '3.33' }
  if (s >= 80)  return { letter: 'B',  point: '3.0'  }
  if (s >= 75)  return { letter: 'B-', point: '2.67' }
  if (s >= 70)  return { letter: 'C+', point: '2.33' }
  if (s >= 65)  return { letter: 'C',  point: '2.0'  }
  if (s >= 60)  return { letter: 'C-', point: '1.67' }
  if (s >= 55)  return { letter: 'D+', point: '1.33' }
  if (s >= 50)  return { letter: 'D-', point: '1.0'  }
  if (s >= 25)  return { letter: 'FX', point: '0.5'  }
  return              { letter: 'F',  point: '0'    }
}

function getTraditionalGrade(scoreVal, lang) {
  const s = parseInt(scoreVal, 10)
  if (!s || s <= 0) return ''
  if (lang === 'ru') {
    if (s >= 90) return 'Отлично'
    if (s >= 70) return 'Хорошо'
    if (s >= 50) return 'Удовл.'
    return 'Неуд.'
  }
  if (s >= 90) return 'Өте жақсы'
  if (s >= 70) return 'Жақсы'
  if (s >= 50) return 'Қанағат.'
  return 'Қанағат.сыз'
}

// ─────────────────────────────────────────────
// ПАРСЕР EXCEL
// ─────────────────────────────────────────────
function extractHeaderInfo(ws) {
  const info = {
    specialty: '', specialty_ru: '',
    qualification: '', qualification_2: '', qualification_ru: '',
    institution: '', institution_ru: '',
    start_year: '', end_year: '', group: '',
  }
  const rng = XLSX.utils.decode_range(ws['!ref'] || 'A1')
  const headerTexts = []

  for (let r = 0; r <= 7 && r <= rng.e.r; r++) {
    for (let c = rng.s.c; c <= rng.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })]
      if (cell && cell.v && typeof cell.v === 'string' && cell.v.trim().length > 3)
        headerTexts.push(cell.v.trim().replace(/\n/g, ' '))
    }
  }

  for (const text of headerTexts) {
    const yearsM = text.match(/(\d{4})\s*[-–—]\s*(\d{4})/)
    if (yearsM && !info.start_year) { info.start_year = yearsM[1]; info.end_year = yearsM[2] }

    const specM = text.match(/(\d{8})\s*[«""«"]\s*([^»"""»"]+?)\s*[»"""»"]/)
    if (specM && !info.specialty)
      info.specialty = `${specM[1]} «${specM[2].trim()}» мамандығында`

    const qualM = text.match(/(4S\d+)\s*[«""«"]\s*([^»"""»"]+?)\s*[»"""»"]/)
    if (qualM && !info.qualification) {
      info.qualification = `${qualM[1]} «${qualM[2].trim()}»`
      if (text.includes('біліктілігі бойынша')) info.qualification_2 = 'біліктілігі бойынша'
    }

    const grpM = text.match(/(\d+[а-яәғқңөүұіһА-ЯӘҒҚҢӨҮҰІҺ]+)\s*тобы/)
    if (grpM && !info.group) info.group = grpM[1]
  }

  const instParts = []
  for (let r = 1; r <= 3 && r <= rng.e.r; r++) {
    for (let c = rng.s.c; c <= rng.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })]
      if (cell && cell.v && typeof cell.v === 'string' && cell.v.trim().length > 2)
        instParts.push(cell.v.trim())
    }
  }
  if (instParts.length && !info.institution) {
    let combined = instParts.join(' ')
    const di = combined.toLowerCase().indexOf('директор')
    if (di > 0) combined = combined.slice(0, di)
    combined = combined.replace(/нің\s*$/, '').replace(/,\s*$/, '').trim()
    if (combined) info.institution = `"${combined}" мекемесінде`
  }
  return info
}

function parseExcel(arrayBuffer) {
  const wb  = XLSX.read(arrayBuffer, { type: 'array' })
  const ws  = wb.Sheets[wb.SheetNames[0]]
  const rng = XLSX.utils.decode_range(ws['!ref'] || 'A1')
  const headerInfo = extractHeaderInfo(ws)

  const getRow = (r) => {
    const row = []
    for (let c = rng.s.c; c <= rng.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })]
      row.push(cell ? cell.v : null)
    }
    return row
  }

  const rowModules  = getRow(8)
  const rowSubjects = getRow(9)
  const rowHours    = getRow(10)

  const subjectsMeta = []
  let currentModule = 'ЖБП 00. Жалпы білім беретін пәндер'
  for (let c = 3; c < rowSubjects.length; c++) {
    if (!rowSubjects[c]) continue
    if (rowModules[c]) currentModule = String(rowModules[c]).trim().replace(/\n/g, ' ')
    subjectsMeta.push({ colIdx: c, name_kz: String(rowSubjects[c]).trim(), module: currentModule, hours: rowHours[c] })
  }

  const students = []
  let emptyRows = 0, r = 11
  while (emptyRows < 5) {
    const row = getRow(r++)
    const studentName = row[1]
    if (!studentName) { emptyRows++; continue }
    emptyRows = 0

    const student = {
      id: row[0], full_name: String(studentName),
      name_kz: String(studentName), name_ru: String(studentName),
      document_number: '', ...headerInfo, subjects_list: [],
    }

    for (const meta of subjectsMeta) {
      const cellVal  = meta.colIdx < row.length ? row[meta.colIdx] : null
      const rawText  = cellVal != null ? String(cellVal).trim() : ''
      const rawLower = rawText.toLowerCase()
      let is_pass = false, letter = '', point = '', score = 0

      if (['сын','сынақ','зачет','зачёт','pass','passed'].includes(rawLower)) {
        is_pass = true; letter = 'сын'; point = ''
      } else {
        const n = parseFloat(rawText)
        score = isNaN(n) ? 0 : Math.round(n)
        const g = getGradeInfo(score)
        letter = g.letter; point = g.point
      }
      student.subjects_list.push({
        module: meta.module, name_kz: meta.name_kz,
        hours: meta.hours != null ? String(meta.hours) : '',
        score: is_pass ? '' : score, letter, point, is_pass, raw_value: rawText,
      })
    }
    students.push(student)
  }
  return students
}

// ─────────────────────────────────────────────
// TEXT WRAP
// ─────────────────────────────────────────────
function wrapText(text, maxChars = 28) {
  if (!text) return []
  const lines = []
  for (const para of text.replace(/\|/g, '\n').split('\n')) {
    const words = para.split(/\s+/).filter(Boolean)
    if (!words.length) continue
    let cur = [], curLen = 0
    for (const w of words) {
      const addLen = curLen > 0 ? curLen + 1 + w.length : w.length
      if (addLen > maxChars && cur.length) { lines.push(cur.join(' ')); cur = [w]; curLen = w.length }
      else { cur.push(w); curLen = addLen }
    }
    if (cur.length) lines.push(cur.join(' '))
  }
  return lines
}

// ─────────────────────────────────────────────
// LAYOUT CALCULATOR
// ─────────────────────────────────────────────
function splitCentered(text, threshold = 55) {
  if (!text || text.length <= threshold) return [text]
  const words = text.split(/\s+/)
  const mid   = Math.ceil(words.length / 2)
  return [words.slice(0, mid).join(' '), words.slice(mid).join(' ')]
}

function calculateLayout(student, lang) {
  const areas = [
    { page: 1, x: 24,        yStart: 280 + 3*MM, yLimit: 20 },
    { page: 1, x: 448,       yStart: 563 + 3*MM, yLimit: 20 },
    { page: 2, x: 21  + 1*MM, yStart: 565 + 3*MM, yLimit: 20 },
    { page: 2, x: 448 + 1*MM, yStart: 565 + 3*MM, yLimit: 20 },
  ]
  if (lang === 'ru') {
    areas[0].yStart -= 3.5 * MM; areas[1].yStart -= 1 * MM
    areas[2].yStart += 0.5 * MM; areas[3].yStart += 1 * MM
    areas[0].yLimit += 2 * MM;   areas[1].yLimit += 2 * MM
  }
  if (lang === 'kz') {
    areas[0].yLimit += 2 * MM;   areas[1].yLimit += 2 * MM
  }

  let ai = 0, curY = areas[0].yStart, rowNum = 1, prevModule = null
  const items = []

  for (const subj of student.subjects_list) {
    const module = (subj.module || '').trim()

    if (module && module !== prevModule) {
      const hLines  = wrapText(module, 75)
      const hHeight = hLines.length * 9 + 2
      if (curY - hHeight - 10 < areas[ai].yLimit) {
        if (++ai >= areas.length) break
        curY = areas[ai].yStart
      }
      items.push({ type: 'header', page: areas[ai].page, x: areas[ai].x, y: curY, lines: hLines })
      curY -= hHeight
      prevModule = module
    }

    const lines      = wrapText(subj.name_kz, 28)
    const itemHeight = lines.length * 9 + 2
    if (curY - itemHeight < areas[ai].yLimit) {
      if (++ai >= areas.length) break
      curY = areas[ai].yStart
    }

    const area      = areas[ai]
    const hoursStr  = String(subj.hours || '')
    const scoreStr  = String(subj.score || '')
    const isPass    = !!subj.is_pass || subj.letter === 'сын'
    const hNum      = parseInt(hoursStr, 10)
    const credits   = hNum > 0 ? String(Math.round(hNum / 24)) : ''
    const trad      = isPass ? '' : getTraditionalGrade(scoreStr, lang)
    const passLabel = lang === 'ru' ? 'зачтено' : 'сыналды'

    items.push({
      type: 'subject', page: area.page, x: area.x, y: curY,
      rowNum, lines, hoursStr, credits, scoreStr, isPass, passLabel,
      letter: subj.letter || '', point: subj.point || '', trad,
      hoursOffX:   area.page === 2 ? 171.3 : 165.6,
      creditsOffX: area.page === 2 ? 206   : 200,
      tradOffX:    area.page === 1 ? 339.3 - 2 * MM : 339.3 - 1 * MM,
      subjectOffX: area.page === 1 ? 20 - 1 * MM : 20,
    })
    curY -= itemHeight
    rowNum++
  }
  return items
}

// ─────────────────────────────────────────────
// PAGE 1 LAYOUT
// ─────────────────────────────────────────────
function getPage1Layout(lang, forPdf = false) {
  const extra = forPdf ? 2*MM : 0
  const l = {
    name_x: 103.58,   name_y: 512.18 + 3*MM + extra,
    doc_x:  129.26,   doc_y:  538.56 + 3*MM + extra,
    sx: 83.30,        sy: 497.02 + 3*MM + extra,
    ex: 283.61,       ey: 497.50 + 3*MM + extra,
    inst_x: 210,      inst_y: 480 + 3*MM + extra,
    spec_x: 210,      spec_y: 460 + 3*MM + extra,
    qual_x: 210,      qual_y: 440 + 3*MM + extra,
    qual2_x: 210,     qual2_y: 425 + 3*MM + extra,
  }
  if (lang === 'kz') {
    l.doc_x  += 2*MM; l.doc_y  -= 1*MM
    l.sy     -= 1*MM; l.ey     -= 1*MM
    l.inst_y -= 2*MM; l.spec_y -= 1*MM
    l.qual_y -= 1*MM; l.qual2_y -= 2*MM
  }
  if (lang === 'ru') {
    l.doc_x  += 13*MM; l.doc_y  -= 1*MM
    l.name_y -= 1*MM
    l.sx     += 23*MM; l.sy     -= 3*MM
    l.ex     += 10*MM; l.ey     -= 3*MM
    l.inst_y -= 4*MM;  l.spec_y -= 3*MM
    l.qual_y -= 3*MM
  }
  return l
}

// ReportLab Y (bottom-origin) → CSS top (top-origin)
const rl = (y) => PAGE_H - y

// ─────────────────────────────────────────────
// ATTESTAT PAGE COMPONENT
// ─────────────────────────────────────────────
function AttestatPage({ student, pageNum, lang, template, items, noTemplate = false }) {
  const l  = getPage1Layout(lang, noTemplate)
  const FS = 8

  let nameVal, instTxt, specTxt, qualTxt, qual2Txt
  if (lang === 'ru') {
    nameVal  = student.name_ru || student.name_kz || ''
    instTxt  = 'Учреждение "Уральский гуманитарно-технический колледж"'
    const sr = student.specialty_ru ||
      (student.specialty || '').replace(/мамандығында\s*$/, '').trim()
    specTxt  = sr || '01140100 "Педагогика и методика начального обучения"'
    qualTxt  = student.qualification_ru || student.qualification ||
      'квалификации 4S01140101 "Учитель начального образования"'
    qual2Txt = student.qualification_2_ru || ''
  } else {
    nameVal  = student.name_kz || ''
    instTxt  = '"Орал гуманитарлық-техникалық колледжі" мекемесінде'
    const sp = (student.specialty || '').replace(/мамандығында\s*$/, '').trim()
    specTxt  = (sp || '01140100 «Бастауыш білім беру педагогикасы мен әдістемесі»') + ' мамандығында'
    qualTxt  = student.qualification || '4S01140101 «Бастауыш білім беру мұғалімі»'
    qual2Txt = student.qualification_2 || 'біліктілігі бойынша'
  }

  const specLines = splitCentered(specTxt)
  const qualLines = splitCentered(qualTxt)
  const pageItems = items.filter(it => it.page === pageNum)
  const pdfShift  = noTemplate ? 2*MM : 0

  const Centered = ({ x, cssTop, children, xOff = 0 }) => (
    <span style={{
      position: 'absolute',
      left:     `${x + xOff - 200}pt`,
      width:    '400pt',
      top:      `${cssTop}pt`,
      textAlign: 'center',
      fontFamily: 'Arial, sans-serif',
      fontSize: '10pt',
      fontWeight: 'bold',
      lineHeight: 1,
      color: '#000',
    }}>
      {children}
    </span>
  )

  const T = ({ style, children }) => (
    <span style={{ position: 'absolute', fontFamily: 'Arial, sans-serif', lineHeight: 1, color: '#000', ...style }}>
      {children}
    </span>
  )

  const specShifts = lang === 'ru' ? [2.5 * MM, 5 * MM] : [3 * MM, 5 * MM]
  const specXOff = (lang === 'ru') ? [15 * MM, 0] : [0, 0]

  const specLineCount = specLines.length
  const extraSpecLines = Math.max(0, specLineCount - 2)
  const freeLineUp     = specLineCount === 1 ? (12 + 2 * MM) : 0
  const qualYShift     = extraSpecLines * 12 + 12 + 2 * MM - freeLineUp

  const qualLineCount = qualLines.length
  const qual2Extra    = (qualLineCount - 1) * 12 + (qualLineCount > 1 ? 2 * MM : 0)

  return (
    <div
      className="attestat-page"
      style={{
        position: 'relative',
        width: `${PAGE_W}pt`,
        height: `${PAGE_H}pt`,
        overflow: 'hidden',
        background: '#fff',
        flexShrink: 0,
      }}
    >
      {!noTemplate && (
        <img
          src={template}
          alt=""
          style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'fill' }}
        />
      )}

      {pageNum === 1 && (
        <>
          <T style={{ left:`${l.name_x}pt`, top:`${rl(l.name_y)}pt`, fontSize:'11pt', fontWeight:'bold', whiteSpace:'nowrap' }}>
            {nameVal}
          </T>
          <T style={{ left:`${l.doc_x}pt`, top:`${rl(l.doc_y)}pt`, fontSize:'11pt', fontWeight:'bold', whiteSpace:'nowrap' }}>
            {student.document_number || ''}
          </T>
          <T style={{ left:`${l.sx}pt`, top:`${rl(l.sy)}pt`, fontSize:'11pt', fontWeight:'bold' }}>
            {student.start_year || '2023'}
          </T>
          <T style={{ left:`${l.ex}pt`, top:`${rl(l.ey)}pt`, fontSize:'11pt', fontWeight:'bold' }}>
            {student.end_year || '2026'}
          </T>
          <Centered x={l.inst_x} cssTop={rl(l.inst_y)}>
            {instTxt}
          </Centered>
          {specLines.map((line, i) => {
            const shift  = specShifts[i] ?? specShifts[specShifts.length - 1]
            const cssTop = rl(l.spec_y) - 6 + i * 12 + shift
            return (
              <Centered key={`spec${i}`} x={l.spec_x} xOff={specXOff[i] ?? 0} cssTop={cssTop}>
                {line}
              </Centered>
            )
          })}
          {qualLines.map((line, i) => {
            const extraDown = i > 0 ? 2 * MM : 0
            const cssTop    = rl(l.qual_y) + qualYShift + i * 12 + extraDown
            return (
              <Centered key={`qual${i}`} x={l.qual_x} cssTop={cssTop}>
                {line}
              </Centered>
            )
          })}
          {qual2Txt && (
            <Centered x={l.qual2_x} cssTop={rl(l.qual2_y) + qualYShift + qual2Extra}>
              {qual2Txt}
            </Centered>
          )}
        </>
      )}

      {pageItems.map((item, i) => {
        const itemTop = rl(item.y) - pdfShift
        if (item.type === 'header') {
          return item.lines.map((line, li) => (
            <T key={`h${i}-${li}`} style={{
              left: `${item.x}pt`,
              top:  `${itemTop + li * 9}pt`,
              fontSize: `${FS}pt`,
              fontWeight: 'bold',
            }}>
              {line}
            </T>
          ))
        }
        return (
          <span key={`s${i}`}>
            <T style={{ left:`${item.x}pt`, top:`${itemTop}pt`, fontSize:`${FS}pt` }}>
              {item.rowNum}
            </T>
            {item.lines.map((line, li) => (
              <T key={li} style={{ left:`${item.x + item.subjectOffX}pt`, top:`${itemTop + li * 9}pt`, fontSize:`${FS}pt` }}>
                {line}
              </T>
            ))}
            <T style={{ left:`${item.x + item.hoursOffX}pt`, top:`${itemTop}pt`, fontSize:`${FS}pt`, transform:'translateX(-50%)' }}>
              {item.hoursStr}
            </T>
            {item.credits && (
              <T style={{ left:`${item.x + item.creditsOffX}pt`, top:`${itemTop}pt`, fontSize:`${FS}pt`, transform:'translateX(-50%)' }}>
                {item.credits}
              </T>
            )}
            {item.isPass ? (
              <T style={{ left:`${item.x + item.tradOffX}pt`, top:`${itemTop}pt`, fontSize:`${FS}pt` }}>
                {item.passLabel}
              </T>
            ) : (
              <>
                <T style={{ left:`${item.x + 235}pt`,           top:`${itemTop}pt`, fontSize:`${FS}pt` }}>{item.scoreStr}</T>
                <T style={{ left:`${item.x + 258}pt`,           top:`${itemTop}pt`, fontSize:`${FS}pt` }}>{item.letter}</T>
                <T style={{ left:`${item.x + 295}pt`,           top:`${itemTop}pt`, fontSize:`${FS}pt` }}>{item.point}</T>
                <T style={{ left:`${item.x + item.tradOffX}pt`, top:`${itemTop}pt`, fontSize:`${FS}pt` }}>{item.trad}</T>
              </>
            )}
          </span>
        )
      })}
    </div>
  )
}

// ─────────────────────────────────────────────
// PDF RENDERERS
// ─────────────────────────────────────────────
async function renderPageToCanvas(el) {
  const imgs = Array.from(el.querySelectorAll('img'))
  await Promise.all(imgs.map(async img => {
    if (!img.complete) await new Promise(r => { img.onload = r; img.onerror = r })
    try { await img.decode() } catch (_) {}
  }))
  return html2canvas(el, { scale: 2, useCORS: true, allowTaint: true, logging: false })
}

async function renderPageToCanvasComposite(textEl, templateSrc) {
  const [textCanvas, tmplImg] = await Promise.all([
    html2canvas(textEl, { scale: 2, useCORS: true, allowTaint: true, logging: false, backgroundColor: '#ffffff' }),
    new Promise(res => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => res(img)
      img.onerror = () => res(null)
      img.src = templateSrc
    }),
  ])
  if (!tmplImg) return textCanvas
  const out = document.createElement('canvas')
  out.width  = textCanvas.width
  out.height = textCanvas.height
  const ctx  = out.getContext('2d')
  ctx.drawImage(tmplImg, 0, 0, out.width, out.height)
  ctx.globalCompositeOperation = 'multiply'
  ctx.drawImage(textCanvas, 0, 0)
  return out
}

// ═══════════════════════════════════════════════════
// DESIGN SYSTEM — ICONS
// ═══════════════════════════════════════════════════
const Icon = ({ d, size = 18, strokeWidth = 1.75, fill = 'none', style, ...rest }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke="currentColor"
       strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
       style={{ flexShrink: 0, ...style }} {...rest}>
    {typeof d === 'string' ? <path d={d} /> : d}
  </svg>
)

const I = {
  Home:       p => <Icon {...p} d="M3 11l9-7 9 7M5 10v10h14V10" />,
  Upload:     p => <Icon {...p} d={<><path d="M12 3v13"/><path d="M7 8l5-5 5 5"/><path d="M4 17v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></>} />,
  Users:      p => <Icon {...p} d={<><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="7" r="2.5"/><path d="M15.5 13.5c2.5 0 5 1.5 5 5"/></>} />,
  FileText:   p => <Icon {...p} d={<><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6M9 9h2"/></>} />,
  Printer:    p => <Icon {...p} d={<><path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="9" rx="1.5"/><path d="M6 14h12v7H6z"/><circle cx="17.5" cy="12" r=".8" fill="currentColor"/></>} />,
  Search:     p => <Icon {...p} d={<><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></>} />,
  Plus:       p => <Icon {...p} d="M12 5v14M5 12h14" />,
  Check:      p => <Icon {...p} d="M4 12l5 5 11-12" />,
  X:          p => <Icon {...p} d="M6 6l12 12M18 6L6 18" />,
  ChevronRight: p => <Icon {...p} d="M9 6l6 6-6 6" />,
  ChevronDown:  p => <Icon {...p} d="M6 9l6 6 6-6" />,
  ChevronLeft:  p => <Icon {...p} d="M15 6l-6 6 6 6" />,
  Download:   p => <Icon {...p} d={<><path d="M12 3v13"/><path d="M7 11l5 5 5-5"/><path d="M4 19v1a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1"/></>} />,
  Sheet:      p => <Icon {...p} d={<><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></>} />,
  Edit:       p => <Icon {...p} d={<><path d="M4 20h4l11-11a2.8 2.8 0 0 0-4-4L4 16v4z"/><path d="M14 6l4 4"/></>} />,
  Sparkles:   p => <Icon {...p} d={<><path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8L12 3z"/><path d="M19 14l.9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14z"/></>} />,
  Sun:        p => <Icon {...p} d={<><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></>} />,
  Moon:       p => <Icon {...p} d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />,
  Palette:    p => <Icon {...p} d={<><path d="M12 3a9 9 0 1 0 0 18 2 2 0 0 0 2-2 1.5 1.5 0 0 1 1.5-1.5H18a3 3 0 0 0 3-3A9 9 0 0 0 12 3z"/><circle cx="7.5" cy="10.5" r="1" fill="currentColor"/><circle cx="12" cy="7.5" r="1" fill="currentColor"/><circle cx="16.5" cy="10.5" r="1" fill="currentColor"/></>} />,
  Bell:       p => <Icon {...p} d={<><path d="M6 8a6 6 0 0 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9z"/><path d="M10 21a2 2 0 0 0 4 0"/></>} />,
  School:     p => <Icon {...p} d={<><path d="M3 9l9-5 9 5-9 5-9-5z"/><path d="M6 11v5a6 6 0 0 0 12 0v-5"/><path d="M12 14v7"/></>} />,
  Eye:        p => <Icon {...p} d={<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></>} />,
  AlertCircle:p => <Icon {...p} d={<><circle cx="12" cy="12" r="9"/><path d="M12 8v5"/><circle cx="12" cy="16" r=".8" fill="currentColor"/></>} />,
  MoreH:      p => <Icon {...p} d={<><circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/></>} />,
}

// ═══════════════════════════════════════════════════
// DESIGN SYSTEM — PRIMITIVES
// ═══════════════════════════════════════════════════
const Btn = ({ variant = 'primary', size = 'md', icon, children, disabled, onClick, style, ...rest }) => {
  const sizes = {
    sm: { padding: '6px 10px', fontSize: 12.5, height: 30 },
    md: { padding: '8px 14px', fontSize: 13.5, height: 36 },
    lg: { padding: '12px 20px', fontSize: 15,   height: 44 },
  }
  const variants = {
    primary:   { background: 'var(--ink)',     color: 'var(--bg-elev)',     border: '1px solid var(--ink)' },
    accent:    { background: 'var(--primary)', color: 'var(--primary-ink)', border: '1px solid var(--primary)' },
    secondary: { background: 'var(--bg-elev)', color: 'var(--ink)',         border: '1px solid var(--line-strong)' },
    ghost:     { background: 'transparent',    color: 'var(--ink-2)',       border: '1px solid transparent' },
    danger:    { background: 'var(--danger)',   color: '#fff',              border: '1px solid var(--danger)' },
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        gap: 7, borderRadius: 'var(--radius)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontWeight: 600, fontFamily: 'inherit',
        transition: 'all .15s ease', whiteSpace: 'nowrap', userSelect: 'none',
        letterSpacing: '-0.01em', opacity: disabled ? 0.5 : 1,
        ...sizes[size], ...variants[variant], ...style,
      }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.transform = 'translateY(-1px)' }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)' }}
      {...rest}
    >
      {icon}{children}
    </button>
  )
}

const Card = ({ children, style, padded = true, ...rest }) => (
  <div style={{
    background: 'var(--bg-elev)',
    border: '1px solid var(--line)',
    borderRadius: 'var(--radius-lg)',
    padding: padded ? 20 : 0,
    boxShadow: 'var(--shadow-sm)',
    ...style,
  }} {...rest}>{children}</div>
)

const Badge = ({ children, tone = 'neutral', style }) => {
  const tones = {
    neutral: { background: 'var(--bg-sunken)', color: 'var(--ink-2)',   border: '1px solid var(--line)' },
    primary: { background: 'var(--primary-soft)', color: 'var(--primary)', border: '1px solid transparent' },
    accent:  { background: 'var(--accent-soft)',  color: 'var(--accent)',  border: '1px solid transparent' },
    success: { background: 'var(--success-soft)', color: 'var(--success)', border: '1px solid transparent' },
    danger:  { background: 'var(--danger-soft)',  color: 'var(--danger)',  border: '1px solid transparent' },
  }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '2px 8px', borderRadius: 999, fontSize: 11.5, fontWeight: 600,
      letterSpacing: '-0.005em', ...tones[tone], ...style,
    }}>{children}</span>
  )
}

const DSInput = ({ prefix, suffix, style, ...rest }) => (
  <div style={{
    display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', height: 36,
    background: 'var(--bg-elev)', border: '1px solid var(--line-strong)',
    borderRadius: 'var(--radius)', color: 'var(--ink)', ...style,
  }}>
    {prefix && <span style={{ color: 'var(--ink-3)', display: 'flex' }}>{prefix}</span>}
    <input style={{
      flex: 1, border: 'none', outline: 'none', background: 'transparent',
      fontFamily: 'inherit', fontSize: 13.5, color: 'inherit', height: '100%',
    }} {...rest} />
    {suffix}
  </div>
)

const Progress = ({ value, style }) => (
  <div style={{ height: 6, background: 'var(--bg-sunken)', borderRadius: 999, overflow: 'hidden', ...style }}>
    <div style={{
      height: '100%', width: `${value}%`, background: 'var(--primary)',
      borderRadius: 999, transition: 'width .4s ease',
    }} />
  </div>
)

// ═══════════════════════════════════════════════════
// LAYOUT — SIDEBAR + TOPBAR
// ═══════════════════════════════════════════════════
const NAV = [
  { key: 'dashboard', label: 'Басты бет',       icon: 'Home'     },
  { key: 'import',    label: 'Excel импорты',    icon: 'Upload'   },
  { key: 'students',  label: 'Оқушылар',         icon: 'Users'    },
  { key: 'template',  label: 'Аттестат үлгісі',  icon: 'FileText' },
  { key: 'generate',  label: 'Басып шығару',     icon: 'Printer'  },
]

function Sidebar({ active, onNav, lang, setLang, students }) {
  return (
    <aside style={{
      width: 240, flexShrink: 0,
      background: 'var(--bg)',
      borderRight: '1px solid var(--line)',
      display: 'flex', flexDirection: 'column',
      padding: '18px 14px',
      position: 'sticky', top: 0, height: '100vh', overflowY: 'auto',
    }}>
      {/* Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 6px 20px' }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8,
          background: 'var(--ink)', color: 'var(--bg-elev)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 800,
        }}>
          <span style={{ fontFamily: 'var(--doc-font)', fontStyle: 'italic', fontSize: 18 }}>A</span>
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: '-0.02em' }}>Atestat</div>
          <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>Толтыру жүйесі</div>
        </div>
      </div>

      {/* School badge */}
      <div style={{
        padding: '8px 10px', borderRadius: 10,
        background: 'var(--bg-sunken)', border: '1px solid var(--line)',
        display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16,
      }}>
        <div style={{
          width: 28, height: 28, borderRadius: 6,
          background: 'var(--bg-elev)', border: '1px solid var(--line)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)',
        }}>
          <I.School size={15} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>УГТК Орал</div>
          <div style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>2025–2026 оқу жылы</div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '10px 10px 6px' }}>
          Жұмыс процесі
        </div>
        {NAV.map(n => {
          const IconC = I[n.icon]
          const on = active === n.key
          return (
            <button key={n.key} onClick={() => onNav(n.key)} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
              border: on ? '1px solid var(--line)' : '1px solid transparent',
              background: on ? 'var(--bg-elev)' : 'transparent',
              color: on ? 'var(--ink)' : 'var(--ink-2)',
              borderRadius: 8, cursor: 'pointer', width: '100%', textAlign: 'left',
              fontSize: 13.5, fontWeight: on ? 600 : 500, fontFamily: 'inherit',
              boxShadow: on ? 'var(--shadow-sm)' : 'none', transition: 'all .12s ease',
            }}>
              <IconC size={16} style={{ color: on ? 'var(--primary)' : 'var(--ink-3)' }} />
              <span style={{ flex: 1 }}>{n.label}</span>
              {n.key === 'students' && students.length > 0 && (
                <span style={{ fontSize: 11, color: 'var(--ink-3)', fontWeight: 500 }}>{students.length}</span>
              )}
            </button>
          )
        })}
      </nav>

      {/* Lang toggle */}
      <div style={{ marginTop: 16, padding: '12px 10px', borderTop: '1px solid var(--line)' }}>
        <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
          Тіл / Язык
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {[['kz','Қазақша'],['ru','Русская']].map(([v,l]) => (
            <button key={v} onClick={() => setLang(v)} style={{
              flex: 1, padding: '6px 8px', borderRadius: 7, border: 'none', cursor: 'pointer',
              background: lang === v ? 'var(--primary)' : 'var(--bg-sunken)',
              color: lang === v ? 'var(--primary-ink)' : 'var(--ink-3)',
              fontSize: 12, fontWeight: 600, fontFamily: 'inherit', transition: 'all .12s ease',
            }}>{l}</button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1 }} />

      {/* User */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 8px', borderTop: '1px solid var(--line)',
      }}>
        <div style={{
          width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
          background: 'var(--primary)', color: 'var(--primary-ink)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 700, fontSize: 11,
        }}>АД</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Директор орынбасары</div>
          <div style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>УГТК Орал</div>
        </div>
      </div>
    </aside>
  )
}

function Topbar({ title, subtitle, actions }) {
  return (
    <header style={{
      padding: '20px 32px', borderBottom: '1px solid var(--line)',
      display: 'flex', alignItems: 'flex-end', gap: 20,
      background: 'var(--bg)', position: 'sticky', top: 0, zIndex: 5,
      backdropFilter: 'blur(8px)',
    }}>
      <div style={{ flex: 1 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: '-0.03em', fontFamily: 'inherit' }}>{title}</h1>
        {subtitle && <p style={{ margin: '4px 0 0', color: 'var(--ink-3)', fontSize: 13 }}>{subtitle}</p>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>{actions}</div>
    </header>
  )
}

// ═══════════════════════════════════════════════════
// SCREEN: DASHBOARD
// ═══════════════════════════════════════════════════
function ScreenDashboard({ students, onNav }) {
  const totalSubjs = students[0]?.subjects_list?.length || 0
  const totalMods  = new Set(students[0]?.subjects_list?.map(s => s.module) || []).size

  return (
    <div style={{ padding: '24px 32px 60px', display: 'flex', flexDirection: 'column', gap: 20, overflowY: 'auto' }}>
      {/* Hero */}
      <Card padded={false} style={{ background: 'linear-gradient(180deg, var(--bg-elev), var(--bg-sunken))' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 28, padding: 28 }}>
          <div style={{ flex: 1 }}>
            <Badge tone="primary" style={{ marginBottom: 12 }}>
              <span style={{ width: 6, height: 6, background: 'var(--primary)', borderRadius: '50%', display: 'inline-block' }} />
              2025–2026 оқу жылы
            </Badge>
            <h2 style={{ margin: 0, fontFamily: 'var(--doc-font)', fontWeight: 400, fontSize: 36, letterSpacing: '-0.02em', lineHeight: 1.1 }}>
              Қайырлы күн<em style={{ color: 'var(--primary)' }}>.</em>
            </h2>
            <p style={{ margin: '10px 0 20px', fontSize: 14, color: 'var(--ink-2)', maxWidth: 480, lineHeight: 1.6 }}>
              {students.length > 0
                ? `${students.length} оқушының деректері жүктелді. Аттестаттарды PDF форматында жасауға дайынсыз.`
                : 'Excel кестесінен деректерді импорттап, аттестаттарды автоматты түрде толтырыңыз.'}
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Btn variant="accent" size="lg" icon={<I.Upload size={16} />} onClick={() => onNav('import')}>
                Excel жүктеу
              </Btn>
              {students.length > 0 && (
                <Btn variant="secondary" size="lg" icon={<I.FileText size={16} />} onClick={() => onNav('template')}>
                  Аттестат үлгісі
                </Btn>
              )}
            </div>
          </div>

          {/* Decorative certificate */}
          <div style={{
            width: 190, height: 250, flexShrink: 0,
            background: 'var(--bg-elev)', border: '1px solid var(--line-strong)',
            borderRadius: 10, boxShadow: 'var(--shadow-lg)', padding: 18,
            position: 'relative', transform: 'rotate(2.5deg)', fontFamily: 'var(--doc-font)',
          }}>
            <div style={{ position: 'absolute', inset: 8, border: '1px double var(--accent)', borderRadius: 6, pointerEvents: 'none' }} />
            <div style={{ textAlign: 'center', fontSize: 7.5, letterSpacing: '0.1em', color: 'var(--accent)', fontFamily: 'var(--ui-font)', fontWeight: 600 }}>
              ҚАЗАҚСТАН РЕСПУБЛИКАСЫ
            </div>
            <div style={{ textAlign: 'center', marginTop: 14, fontSize: 13, lineHeight: 1.3 }}>Жалпы орта білім туралы</div>
            <div style={{ textAlign: 'center', fontSize: 19, marginTop: 4 }}>АТТЕСТАТ</div>
            <div style={{ marginTop: 20, fontSize: 10, color: 'var(--ink-2)', fontFamily: 'var(--ui-font)', textAlign: 'center', lineHeight: 1.6 }}>
              Осы аттестат<br />
              <span style={{ borderBottom: '1px solid var(--ink-4)', padding: '2px 10px' }}>Аттестатталушыға</span><br />
              берілді
            </div>
            <div style={{
              position: 'absolute', bottom: 14, right: 14,
              width: 38, height: 38, borderRadius: '50%',
              border: '1.5px solid var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--accent)', fontSize: 7, fontWeight: 700, letterSpacing: '0.08em',
              fontFamily: 'var(--ui-font)', transform: 'rotate(-10deg)', textAlign: 'center', lineHeight: 1.2,
            }}>МӨР<br/>2026</div>
          </div>
        </div>
      </Card>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
        {[
          { label: 'Барлық оқушы', value: students.length || '—', icon: 'Users',    tone: 'neutral'  },
          { label: 'Пәндер саны',  value: totalSubjs   || '—', icon: 'FileText', tone: 'primary'  },
          { label: 'Модульдер',    value: totalMods    || '—', icon: 'Sparkles', tone: 'accent'   },
        ].map((s, i) => {
          const IconC = I[s.icon]
          const bgMap = { neutral: 'var(--bg-sunken)', primary: 'var(--primary-soft)', accent: 'var(--accent-soft)' }
          const fgMap = { neutral: 'var(--ink-2)',     primary: 'var(--primary)',       accent: 'var(--accent)'      }
          return (
            <Card key={i} style={{ padding: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{ width: 30, height: 30, borderRadius: 8, background: bgMap[s.tone], color: fgMap[s.tone], display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <IconC size={15} />
                </div>
                <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{s.label}</div>
              </div>
              <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1 }}>{s.value}</div>
            </Card>
          )
        })}
      </div>

      {/* Quick actions */}
      <Card padded={false}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--line)' }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Жылдам әрекеттер</h3>
        </div>
        <div style={{ padding: 16, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {[
            { label: 'Excel жүктеу',    icon: 'Upload',   nav: 'import',    variant: 'accent'     },
            { label: 'Оқушылар тізімі', icon: 'Users',    nav: 'students',  variant: 'secondary'  },
            { label: 'Үлгіні қарау',    icon: 'Eye',      nav: 'template',  variant: 'secondary'  },
            { label: 'PDF жасау',       icon: 'Printer',  nav: 'generate',  variant: 'secondary'  },
          ].map((a, i) => {
            const IconC = I[a.icon]
            return <Btn key={i} variant={a.variant} icon={<IconC size={14} />} onClick={() => onNav(a.nav)}>{a.label}</Btn>
          })}
        </div>
      </Card>
    </div>
  )
}

// ═══════════════════════════════════════════════════
// SCREEN: IMPORT
// ═══════════════════════════════════════════════════
function ScreenImport({ students, loading, error, fileRef, handleFile, lang, setLang, onNav }) {
  const [dragOver, setDragOver] = useState(false)

  return (
    <div style={{ padding: '24px 32px 60px', display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 680, overflowY: 'auto' }}>
      {/* Language */}
      <Card>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 10 }}>Аттестат нұсқасы</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {[['kz','Қазақша'],['ru','Русская']].map(([v,l]) => (
            <button key={v} onClick={() => setLang(v)} style={{
              flex: 1, padding: '10px 8px', borderRadius: 8,
              background: lang === v ? 'var(--bg-sunken)' : 'var(--bg-elev)',
              border: lang === v ? '1px solid var(--ink)' : '1px solid var(--line)',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: 6, color: 'var(--ink)', fontFamily: 'inherit', fontSize: 13.5, fontWeight: 600,
              transition: 'all .12s',
            }}>
              {lang === v && <I.Check size={14} style={{ color: 'var(--primary)' }} />}
              {l}
            </button>
          ))}
        </div>
      </Card>

      {/* Drop zone */}
      <div
        style={{
          border: dragOver ? '2px dashed var(--primary)' : '2px dashed var(--line-strong)',
          borderRadius: 'var(--radius-lg)',
          background: dragOver ? 'var(--primary-soft)' : 'var(--bg-elev)',
          cursor: 'pointer', transition: 'all .15s',
          padding: 48, textAlign: 'center',
        }}
        onClick={() => fileRef.current?.click()}
        onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files?.[0]) }}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
      >
        <div style={{
          width: 52, height: 52, borderRadius: 14, margin: '0 auto 14px',
          background: 'var(--primary-soft)', color: 'var(--primary)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <I.Sheet size={26} />
        </div>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>Excel файлын жүктеңіз</div>
        <div style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 18 }}>Файлды осы жерге апарыңыз немесе басыңыз</div>
        <Btn variant="secondary" icon={<I.Upload size={14} />}>.xlsx файлын таңдаңыз</Btn>
        <input ref={fileRef} type="file" accept=".xlsx" style={{ display: 'none' }} onChange={e => handleFile(e.target.files?.[0])} />
      </div>

      {loading && (
        <Card style={{ padding: 16 }}>
          <div style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 8 }}>Excel файлы оқылуда...</div>
          <Progress value={60} />
        </Card>
      )}

      {error && (
        <Card style={{ border: '1px solid var(--danger)', background: 'var(--danger-soft)', padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <I.AlertCircle size={16} style={{ color: 'var(--danger)', flexShrink: 0 }} />
            <span style={{ fontSize: 13.5, color: 'var(--danger)' }}>{error}</span>
          </div>
        </Card>
      )}

      {students.length > 0 && (
        <Card style={{ border: '1px solid var(--success)', background: 'var(--success-soft)', padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 34, height: 34, borderRadius: 9, flexShrink: 0,
              background: 'var(--success)', color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <I.Check size={17} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--success)' }}>Деректер сәтті жүктелді</div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>
                {students.length} оқушы · {students[0]?.subjects_list?.length || 0} пән
              </div>
            </div>
            <Btn variant="accent" size="sm" icon={<I.Users size={13} />} onClick={() => onNav('students')}>
              Тізімді қарау
            </Btn>
          </div>
        </Card>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════
// SCREEN: STUDENTS
// ═══════════════════════════════════════════════════
function ScreenStudents({ students, selIdx, setSelIdx, onNav, selected, setSelected }) {
  const [query, setQuery] = useState('')

  const filtered = students.filter(s =>
    !query || s.full_name.toLowerCase().includes(query.toLowerCase())
  )

  const toggleAll = () => {
    if (selected.length === students.length) setSelected([])
    else setSelected(students.map((_, i) => i))
  }
  const toggleOne = (idx) => setSelected(
    selected.includes(idx) ? selected.filter(x => x !== idx) : [...selected, idx]
  )

  if (!students.length) return (
    <div style={{ padding: '60px 32px', textAlign: 'center' }}>
      <div style={{ width: 52, height: 52, borderRadius: 14, margin: '0 auto 14px', background: 'var(--bg-sunken)', color: 'var(--ink-3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <I.Users size={22} />
      </div>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>Оқушылар жоқ</div>
      <div style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 18 }}>Алдымен Excel файлын жүктеңіз</div>
      <Btn variant="accent" icon={<I.Upload size={14} />} onClick={() => onNav('import')}>Excel жүктеу</Btn>
    </div>
  )

  return (
    <div style={{ padding: '20px 32px 60px', display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <DSInput prefix={<I.Search size={14} />} placeholder="Оқушының атын іздеу…"
          value={query} onChange={e => setQuery(e.target.value)} style={{ width: 260 }} />
        <div style={{ flex: 1 }} />
        {selected.length > 0 && (
          <Btn variant="accent" size="md" icon={<I.Printer size={14} />} onClick={() => onNav('generate')}>
            Таңдалған ({selected.length}) PDF
          </Btn>
        )}
        {selected.length > 0 && (
          <Btn variant="ghost" size="md" onClick={() => setSelected([])}>Болдырмау</Btn>
        )}
      </div>

      {selected.length > 0 && (
        <div style={{ padding: '10px 14px', borderRadius: 10, background: 'var(--primary-soft)', border: '1px solid var(--primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <I.Check size={14} style={{ color: 'var(--primary)' }} />
          <span style={{ fontSize: 13, color: 'var(--primary)', fontWeight: 600 }}>
            {selected.length} оқушы таңдалды
          </span>
        </div>
      )}

      {/* Table */}
      <Card padded={false}>
        <div style={{
          display: 'grid', gridTemplateColumns: '36px 1fr 100px 90px 130px',
          padding: '10px 16px', borderBottom: '1px solid var(--line)',
          fontSize: 11, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em',
        }}>
          <div>
            <input type="checkbox"
              checked={selected.length === students.length && students.length > 0}
              onChange={toggleAll} style={{ cursor: 'pointer' }} />
          </div>
          <div>Аты-жөні</div>
          <div>Пәндер</div>
          <div>Орташа балл</div>
          <div></div>
        </div>
        {filtered.map((s, fi) => {
          const idx = students.indexOf(s)
          const isSelected = selected.includes(idx)
          const subjCount = s.subjects_list?.length || 0
          const scored = s.subjects_list?.filter(sub => !sub.is_pass && sub.score) || []
          const avg = scored.length ? (scored.reduce((sum, sub) => sum + parseFloat(sub.score || 0), 0) / scored.length).toFixed(1) : '—'

          return (
            <div key={idx} style={{
              display: 'grid', gridTemplateColumns: '36px 1fr 100px 90px 130px',
              padding: '12px 16px', borderBottom: '1px solid var(--line)',
              alignItems: 'center',
              background: isSelected ? 'var(--primary-soft)' : 'transparent',
              transition: 'background .1s',
            }}>
              <div>
                <input type="checkbox" checked={isSelected} onChange={() => toggleOne(idx)} style={{ cursor: 'pointer' }} />
              </div>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>{s.full_name}</div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 2 }}>
                  {s.document_number ? `Аттестат № ${s.document_number}` : 'Нөмір белгіленбеген'}
                </div>
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>{subjCount} пән</div>
              <div>
                <Badge tone={parseFloat(avg) >= 85 ? 'success' : parseFloat(avg) >= 70 ? 'primary' : 'neutral'}>
                  {avg}
                </Badge>
              </div>
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                <Btn variant="ghost" size="sm" icon={<I.Eye size={13} />}
                  onClick={() => { setSelIdx(idx); onNav('template') }}>
                  Қарау
                </Btn>
              </div>
            </div>
          )
        })}
      </Card>
    </div>
  )
}

// ═══════════════════════════════════════════════════
// SCREEN: TEMPLATE (preview + download with template)
// ═══════════════════════════════════════════════════
function ScreenTemplate({ students, selIdx, setSelIdx, lang, setStudents }) {
  const [scale, setScale]     = useState(0.5)
  const [busy, setBusy]       = useState(false)
  const [status, setStatus]   = useState('')
  const [showEdit, setShowEdit] = useState(false)

  if (!students.length) return (
    <div style={{ padding: '60px 32px', textAlign: 'center' }}>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>Деректер жоқ</div>
      <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>Excel файлын жүктеңіз</div>
    </div>
  )

  const s     = students[Math.min(selIdx, students.length - 1)] || students[0]
  const items = calculateLayout(s, lang)
  const tmpls = lang === 'ru'
    ? ['/data/template_ru_fixed.jpg', '/data/template_ru_2_fixed.jpg']
    : ['/data/template_kz.jpg', '/data/template_kz_2.jpg']

  const dlWithTemplate = async () => {
    setBusy(true); setStatus('Генерация...')
    try {
      const container = document.createElement('div')
      container.style.cssText = `position:fixed;left:-9999px;top:0;z-index:-1;width:${PAGE_W}pt;`
      document.body.appendChild(container)
      const root = createRoot(container)
      await new Promise(res => {
        root.render(<div>
          <AttestatPage student={s} pageNum={1} lang={lang} template={tmpls[0]} items={items} noTemplate />
          <AttestatPage student={s} pageNum={2} lang={lang} template={tmpls[1]} items={items} noTemplate />
        </div>)
        setTimeout(res, 150)
      })
      const pages = container.querySelectorAll('.attestat-page')
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
      const [c1, c2] = await Promise.all([
        renderPageToCanvasComposite(pages[0], tmpls[0]),
        renderPageToCanvasComposite(pages[1], tmpls[1]),
      ])
      root.unmount(); document.body.removeChild(container)
      pdf.addImage(c1.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, PAGE_W, PAGE_H)
      pdf.addPage([PAGE_W, PAGE_H], 'landscape')
      pdf.addImage(c2.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, PAGE_W, PAGE_H)
      const url = URL.createObjectURL(pdf.output('blob'))
      Object.assign(document.createElement('a'), {
        href: url, download: `${s.name_kz || s.full_name || 'attestat'}_шаблон.pdf`
      }).click()
      URL.revokeObjectURL(url)
      setStatus('✓ Жүктелді')
    } catch (e) { setStatus('❌ ' + e.message) }
    setBusy(false)
  }

  const upd = (field, val) =>
    setStudents(students.map((st, i) => i === selIdx ? { ...st, [field]: val } : st))

  return (
    <div style={{ padding: '20px 32px 60px', display: 'flex', gap: 20, alignItems: 'flex-start', overflowY: 'auto' }}>
      {/* Left: preview */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Student picker */}
        <Card style={{ padding: '10px 14px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => setSelIdx(i => Math.max(0, i - 1))} disabled={selIdx === 0}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--ink-2)', padding: 4, display: 'flex', borderRadius: 6, opacity: selIdx === 0 ? 0.3 : 1 }}>
            <I.ChevronLeft size={18} />
          </button>
          <select value={selIdx} onChange={e => setSelIdx(+e.target.value)} style={{
            flex: 1, border: 'none', background: 'transparent', fontFamily: 'inherit',
            fontSize: 13.5, fontWeight: 600, color: 'var(--ink)', cursor: 'pointer', outline: 'none',
          }}>
            {students.map((st, i) => <option key={i} value={i}>{i + 1}. {st.full_name}</option>)}
          </select>
          <span style={{ fontSize: 12, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>{selIdx + 1} / {students.length}</span>
          <button onClick={() => setSelIdx(i => Math.min(students.length - 1, i + 1))} disabled={selIdx === students.length - 1}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--ink-2)', padding: 4, display: 'flex', borderRadius: 6, opacity: selIdx === students.length - 1 ? 0.3 : 1 }}>
            <I.ChevronRight size={18} />
          </button>
        </Card>

        {/* Preview card */}
        <Card padded={false}>
          <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12, color: 'var(--ink-3)', flex: 1 }}>Алдын ала қарау · {Math.round(scale * 100)}%</span>
            <button onClick={() => setScale(v => Math.max(0.2, +(v - 0.05).toFixed(2)))}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--ink-3)', width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, fontSize: 18, lineHeight: 1 }}>−</button>
            <button onClick={() => setScale(v => Math.min(1.5, +(v + 0.05).toFixed(2)))}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--ink-3)', width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, fontSize: 18, lineHeight: 1 }}>+</button>
          </div>
          <div style={{ overflow: 'auto', maxHeight: '68vh', padding: 12, background: 'var(--bg-sunken)' }}>
            <div style={{ width: `${PAGE_W * scale}pt`, height: `${(PAGE_H * 2 + 10) * scale}pt`, overflow: 'hidden', position: 'relative' }}>
              <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: `${PAGE_W}pt`, display: 'flex', flexDirection: 'column', gap: '10pt' }}>
                <AttestatPage student={s} pageNum={1} lang={lang} template={tmpls[0]} items={items} />
                <AttestatPage student={s} pageNum={2} lang={lang} template={tmpls[1]} items={items} />
              </div>
            </div>
          </div>
          <div style={{ padding: '12px 16px', borderTop: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <Btn variant="accent" icon={<I.Download size={14} />} onClick={dlWithTemplate} disabled={busy} style={{ flex: 1 }}>
              {busy ? 'Жасалуда...' : 'Шаблонмен PDF жүктеу'}
            </Btn>
            {status && (
              <span style={{ fontSize: 12, color: status.startsWith('✓') ? 'var(--success)' : 'var(--danger)' }}>
                {status}
              </span>
            )}
          </div>
        </Card>
      </div>

      {/* Right: edit panel */}
      <div style={{ width: 290, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Card padded={false}>
          <button onClick={() => setShowEdit(!showEdit)} style={{
            width: '100%', padding: '14px 16px', border: 'none', background: 'transparent',
            display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
          }}>
            <I.Edit size={15} style={{ color: 'var(--ink-3)' }} />
            <span style={{ fontSize: 13.5, fontWeight: 600, flex: 1 }}>Деректерді өңдеу</span>
            <I.ChevronDown size={14} style={{ color: 'var(--ink-3)', transform: showEdit ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
          </button>
          {showEdit && (
            <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ height: 10 }} />
              {[
                { field: 'name_kz',         label: 'ФИО (ҚЗ)'    },
                { field: 'name_ru',         label: 'ФИО (РУ)'    },
                { field: 'document_number', label: '№ Аттестат'  },
                { field: 'start_year',      label: 'Басталу жылы' },
                { field: 'end_year',        label: 'Аяқталу жылы' },
              ].map(({ field, label }) => (
                <label key={field} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
                  <input value={s[field] || ''} onChange={e => upd(field, e.target.value)} style={{
                    border: '1px solid var(--line-strong)', borderRadius: 'var(--radius-sm)',
                    padding: '6px 10px', fontSize: 13, background: 'var(--bg-elev)', color: 'var(--ink)',
                    fontFamily: 'inherit', outline: 'none',
                  }} />
                </label>
              ))}
            </div>
          )}
        </Card>

        {/* Subject count */}
        <Card style={{ padding: 14 }}>
          <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 4 }}>Тіркелген пәндер</div>
          <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em' }}>{s.subjects_list?.length || 0}</div>
          <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>пән</div>
        </Card>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════
// SCREEN: GENERATE
// ═══════════════════════════════════════════════════
function ScreenGenerate({ students, selIdx, setSelIdx, lang, selected }) {
  const [busy, setBusy]         = useState(false)
  const [status, setStatus]     = useState('')
  const [progress, setProgress] = useState(0)
  const [mode, setMode]         = useState('single')

  const student = students[Math.min(selIdx, students.length - 1)] || {}
  const tmpls = lang === 'ru'
    ? ['/data/template_ru_fixed.jpg', '/data/template_ru_2_fixed.jpg']
    : ['/data/template_kz.jpg', '/data/template_kz_2.jpg']

  const generateOnePdf = async (s, withTemplate = false) => {
    const it = calculateLayout(s, lang)
    const container = document.createElement('div')
    container.style.cssText = `position:fixed;left:-9999px;top:0;z-index:-1;width:${PAGE_W}pt;`
    document.body.appendChild(container)
    const root = createRoot(container)
    await new Promise(res => {
      root.render(<div>
        <AttestatPage student={s} pageNum={1} lang={lang} template={tmpls[0]} items={it} noTemplate />
        <AttestatPage student={s} pageNum={2} lang={lang} template={tmpls[1]} items={it} noTemplate />
      </div>)
      setTimeout(res, withTemplate ? 200 : 100)
    })
    const pages = container.querySelectorAll('.attestat-page')
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
    const [c1, c2] = await Promise.all([
      withTemplate ? renderPageToCanvasComposite(pages[0], tmpls[0]) : renderPageToCanvas(pages[0]),
      withTemplate ? renderPageToCanvasComposite(pages[1], tmpls[1]) : renderPageToCanvas(pages[1]),
    ])
    root.unmount(); document.body.removeChild(container)
    pdf.addImage(c1.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, PAGE_W, PAGE_H)
    pdf.addPage([PAGE_W, PAGE_H], 'landscape')
    pdf.addImage(c2.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, PAGE_W, PAGE_H)
    return pdf
  }

  const dlSingle = async (withTemplate = false) => {
    setBusy(true); setStatus('Генерация...')
    try {
      const pdf = await generateOnePdf(student, withTemplate)
      const url = URL.createObjectURL(pdf.output('blob'))
      Object.assign(document.createElement('a'), {
        href: url, download: `${student.name_kz || student.full_name || 'attestat'}.pdf`
      }).click()
      URL.revokeObjectURL(url)
      setStatus('✓ Жүктелді')
    } catch (e) { setStatus('❌ ' + e.message) }
    setBusy(false)
  }

  const dlBatch = async (list) => {
    setBusy(true); setProgress(0); setStatus('')
    const zip = new JSZip()
    for (let i = 0; i < list.length; i++) {
      setStatus(`${i + 1} / ${list.length} генерация...`)
      setProgress(Math.round((i / list.length) * 100))
      try {
        const pdf = await generateOnePdf(list[i])
        const name = (list[i].name_kz || list[i].full_name || `student_${i + 1}`).replace(/[/\\?%*:|"<>]/g, '_')
        zip.file(`${name}.pdf`, pdf.output('blob'))
      } catch (_) {}
    }
    setProgress(100)
    const url = URL.createObjectURL(await zip.generateAsync({ type: 'blob' }))
    Object.assign(document.createElement('a'), { href: url, download: 'attestaty.zip' }).click()
    URL.revokeObjectURL(url)
    setStatus(`✓ ${list.length} аттестат ZIP архивіне сақталды`)
    setBusy(false)
  }

  if (!students.length) return (
    <div style={{ padding: '60px 32px', textAlign: 'center' }}>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>Деректер жоқ</div>
      <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>Excel файлын жүктеңіз</div>
    </div>
  )

  const tabs = [
    { k: 'single',   l: 'Жеке оқушы' },
    { k: 'all',      l: `Барлығы (${students.length})` },
    ...(selected.length > 0 ? [{ k: 'selected', l: `Таңдалған (${selected.length})` }] : []),
  ]

  return (
    <div style={{ padding: '24px 32px 60px', display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 720, overflowY: 'auto' }}>
      {/* Mode tabs */}
      <div style={{ display: 'flex', gap: 2, padding: 3, background: 'var(--bg-sunken)', border: '1px solid var(--line)', borderRadius: 12, width: 'fit-content' }}>
        {tabs.map(t => (
          <button key={t.k} onClick={() => setMode(t.k)} style={{
            padding: '7px 16px', borderRadius: 9, border: 'none', cursor: 'pointer',
            background: mode === t.k ? 'var(--bg-elev)' : 'transparent',
            color: mode === t.k ? 'var(--ink)' : 'var(--ink-3)',
            fontSize: 13.5, fontWeight: 600, fontFamily: 'inherit',
            boxShadow: mode === t.k ? 'var(--shadow-sm)' : 'none',
            transition: 'all .12s',
          }}>{t.l}</button>
        ))}
      </div>

      {mode === 'single' && (
        <Card>
          <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 10 }}>Оқушыны таңдаңыз</div>
          <select value={selIdx} onChange={e => setSelIdx(+e.target.value)} style={{
            width: '100%', border: '1px solid var(--line-strong)', borderRadius: 'var(--radius)',
            padding: '8px 12px', fontSize: 13.5, background: 'var(--bg-elev)', color: 'var(--ink)',
            fontFamily: 'inherit', marginBottom: 16, outline: 'none', cursor: 'pointer',
          }}>
            {students.map((s, i) => <option key={i} value={i}>{i + 1}. {s.full_name}</option>)}
          </select>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Btn variant="accent" icon={<I.Download size={14} />} onClick={() => dlSingle(true)} disabled={busy}>
              Шаблонмен PDF
            </Btn>
            <Btn variant="secondary" icon={<I.Download size={14} />} onClick={() => dlSingle(false)} disabled={busy}>
              Шаблонсыз PDF
            </Btn>
          </div>
        </Card>
      )}

      {mode === 'all' && (
        <Card>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Барлық {students.length} оқушының аттестаты</div>
          <div style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 16 }}>ZIP архиві жасалып, барлық PDF файлдар жүктеледі</div>
          <Btn variant="accent" icon={<I.Download size={14} />} onClick={() => dlBatch(students)} disabled={busy}>
            ZIP архивін жүктеу
          </Btn>
        </Card>
      )}

      {mode === 'selected' && selected.length > 0 && (
        <Card>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Таңдалған {selected.length} оқушы</div>
          <div style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 16, lineHeight: 1.5 }}>
            {students.filter((_, i) => selected.includes(i)).map(s => s.full_name).join(', ')}
          </div>
          <Btn variant="accent" icon={<I.Download size={14} />}
            onClick={() => dlBatch(students.filter((_, i) => selected.includes(i)))} disabled={busy}>
            ZIP архивін жүктеу
          </Btn>
        </Card>
      )}

      {(status || (busy && progress > 0)) && (
        <Card style={{ padding: 16 }}>
          {busy && progress > 0 && progress < 100 && <Progress value={progress} style={{ marginBottom: 10 }} />}
          <div style={{ fontSize: 13.5, color: status?.startsWith('✓') ? 'var(--success)' : status?.startsWith('❌') ? 'var(--danger)' : 'var(--ink-3)' }}>
            {status}
          </div>
        </Card>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════
// TWEAKS PANEL
// ═══════════════════════════════════════════════════
const PALETTE = [
  { k: '#0EA5A0', l: 'Teal'   },
  { k: '#2F72D4', l: 'Blue'   },
  { k: '#7B5EA7', l: 'Violet' },
  { k: '#3F8F55', l: 'Green'  },
  { k: '#B5862C', l: 'Gold'   },
  { k: '#141413', l: 'Ink'    },
]
const FONTS = [
  { k: 'Inter Tight',   l: 'Inter Tight'   },
  { k: 'Manrope',       l: 'Manrope'       },
  { k: 'Space Grotesk', l: 'Space Grotesk' },
]

function TweaksPanel({ open, onClose, tweaks, setTweaks }) {
  if (!open) return null
  return (
    <div style={{
      position: 'fixed', right: 20, bottom: 20, width: 290,
      background: 'var(--bg-elev)', border: '1px solid var(--line-strong)',
      borderRadius: 14, boxShadow: 'var(--shadow-lg)', zIndex: 100, overflow: 'hidden',
    }}>
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <I.Sparkles size={14} style={{ color: 'var(--primary)' }} />
        <span style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>Tweaks</span>
        <button onClick={onClose} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 4, color: 'var(--ink-3)', display: 'flex', borderRadius: 6 }}>
          <I.X size={14} />
        </button>
      </div>
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Theme */}
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Тақырып</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {[{ k: 'light', l: 'Жарық', icon: 'Sun' }, { k: 'dark', l: 'Қараңғы', icon: 'Moon' }].map(t => {
              const IconC = I[t.icon]
              const on = tweaks.theme === t.k
              return (
                <button key={t.k} onClick={() => setTweaks({ ...tweaks, theme: t.k })} style={{
                  flex: 1, padding: '10px 8px', borderRadius: 8,
                  background: on ? 'var(--bg-sunken)' : 'var(--bg-elev)',
                  border: on ? '1px solid var(--ink)' : '1px solid var(--line)',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  gap: 6, color: 'var(--ink)', fontFamily: 'inherit', fontSize: 12, fontWeight: 600,
                }}>
                  <IconC size={14} /> {t.l}
                </button>
              )
            })}
          </div>
        </div>

        {/* Color */}
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Негізгі түс</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {PALETTE.map(c => {
              const on = tweaks.primary === c.k
              return (
                <button key={c.k} onClick={() => setTweaks({ ...tweaks, primary: c.k })} title={c.l} style={{
                  width: 32, height: 32, borderRadius: 8, background: c.k,
                  border: on ? '2px solid var(--ink)' : '1px solid var(--line)',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
                }}>
                  {on && <I.Check size={14} style={{ color: '#fff' }} />}
                </button>
              )
            })}
          </div>
        </div>

        {/* Font */}
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Шрифт</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {FONTS.map(f => {
              const on = tweaks.fontFamily === f.k
              return (
                <button key={f.k} onClick={() => setTweaks({ ...tweaks, fontFamily: f.k })} style={{
                  padding: '8px 12px', borderRadius: 8,
                  background: on ? 'var(--bg-sunken)' : 'transparent',
                  border: on ? '1px solid var(--ink)' : '1px solid var(--line)',
                  cursor: 'pointer', textAlign: 'left',
                  fontFamily: `"${f.k}", sans-serif`,
                  fontSize: 14, fontWeight: 600, color: 'var(--ink)',
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <span style={{ flex: 1 }}>{f.l}</span>
                  {on && <I.Check size={14} style={{ color: 'var(--primary)' }} />}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════
const SCREEN_TITLES = {
  dashboard: { t: 'Басты бет',       s: 'Аттестат толтырудың жалпы шолу'  },
  import:    { t: 'Excel импорты',    s: 'Файлды жүктеп, нұсқаны таңдаңыз' },
  students:  { t: 'Оқушылар тізімі', s: 'Импортталған деректер'            },
  template:  { t: 'Аттестат үлгісі', s: 'Деректерді алдын ала қарау'       },
  generate:  { t: 'Басып шығару',    s: 'PDF жасау және экспорттау'        },
}

export default function App() {
  const [students, setStudents] = useState([])
  const [lang, setLang]         = useState('kz')
  const [active, setActive]     = useState('dashboard')
  const [selIdx, setSelIdx]     = useState(0)
  const [selected, setSelected] = useState([])
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [tweaks, setTweaks]     = useState({ theme: 'light', primary: '#0EA5A0', fontFamily: 'Inter Tight' })
  const [tweaksOpen, setTweaksOpen] = useState(false)
  const fileRef = useRef(null)

  // Apply tweaks to <html>
  useEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-theme', tweaks.theme)
    root.style.setProperty('--primary', tweaks.primary)
    root.style.setProperty('--ui-font', `"${tweaks.fontFamily}", system-ui, sans-serif`)
    root.style.setProperty('--primary-ink', tweaks.theme === 'dark' ? '#04302E' : '#FFFFFF')
    root.style.setProperty('--primary-soft', tweaks.primary + (tweaks.theme === 'dark' ? '22' : '1a'))
  }, [tweaks])

  const handleFile = useCallback(async (file) => {
    if (!file) return
    setLoading(true); setError('')
    try {
      const parsed = parseExcel(await file.arrayBuffer())
      if (!parsed.length) throw new Error('Оқушылар табылмады — .xlsx форматын тексеріңіз')
      setStudents(parsed); setSelIdx(0); setActive('students')
    } catch (e) {
      setError(e.message || 'Файл оқу қатесі')
    }
    setLoading(false)
  }, [])

  const onNav = (screen) => setActive(screen)
  const title = SCREEN_TITLES[active]

  const topActions = (
    <>
      <button
        onClick={() => setTweaks({ ...tweaks, theme: tweaks.theme === 'dark' ? 'light' : 'dark' })}
        style={{
          border: '1px solid var(--line)', background: 'var(--bg-elev)',
          borderRadius: 'var(--radius)', width: 36, height: 36, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-3)',
        }}
        title="Тема ауыстыру"
      >
        {tweaks.theme === 'dark' ? <I.Sun size={16} /> : <I.Moon size={16} />}
      </button>
      <Btn variant="accent" icon={<I.Upload size={14} />} onClick={() => { onNav('import'); setTimeout(() => fileRef.current?.click(), 100) }}>
        Жаңа импорт
      </Btn>
    </>
  )

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)', fontFamily: 'var(--ui-font)' }}>
      <Sidebar active={active} onNav={onNav} lang={lang} setLang={setLang} students={students} />

      <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Topbar title={title.t} subtitle={title.s} actions={topActions} />

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {active === 'dashboard' && <ScreenDashboard students={students} onNav={onNav} />}
          {active === 'import'    && <ScreenImport students={students} loading={loading} error={error} fileRef={fileRef} handleFile={handleFile} lang={lang} setLang={setLang} onNav={onNav} />}
          {active === 'students'  && <ScreenStudents students={students} selIdx={selIdx} setSelIdx={setSelIdx} onNav={onNav} selected={selected} setSelected={setSelected} />}
          {active === 'template'  && <ScreenTemplate students={students} selIdx={selIdx} setSelIdx={setSelIdx} lang={lang} setStudents={setStudents} />}
          {active === 'generate'  && <ScreenGenerate students={students} selIdx={selIdx} setSelIdx={setSelIdx} lang={lang} selected={selected} />}
        </div>
      </main>

      {/* Tweaks FAB */}
      {!tweaksOpen && (
        <button onClick={() => setTweaksOpen(true)} style={{
          position: 'fixed', right: 20, bottom: 20, zIndex: 50,
          width: 44, height: 44, borderRadius: '50%',
          background: 'var(--ink)', color: 'var(--bg-elev)',
          border: 'none', cursor: 'pointer', boxShadow: 'var(--shadow-lg)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <I.Palette size={18} />
        </button>
      )}
      <TweaksPanel open={tweaksOpen} onClose={() => setTweaksOpen(false)} tweaks={tweaks} setTweaks={setTweaks} />
    </div>
  )
}
