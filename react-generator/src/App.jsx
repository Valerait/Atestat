// ════════════════════════════════════════════════════════════════
//  Генератор Аттестатов — React/Tailwind (Atestat 2026)
//  Один файл: парсинг Excel + вёрстка A4 + генерация PDF
// ════════════════════════════════════════════════════════════════
import { useState, useRef, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import JSZip from 'jszip'

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
// LAYOUT CALCULATOR — mirrors _draw_grades
// ─────────────────────────────────────────────
function calculateLayout(student, lang) {
  const areas = [
    { page: 1, x: 24,  yStart: 280 + 3*MM, yLimit: 20 },
    { page: 1, x: 448, yStart: 563 + 3*MM, yLimit: 20 },
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
      // trad/pass column X differs per page (mirrors Python trad_col_x logic)
      tradOffX:    area.page === 1 ? 339.3 - 2 * MM : 339.3 - 1 * MM,
      subjectOffX: area.page === 1 ? 20 - 1 * MM : 20,
    })
    curY -= itemHeight
    rowNum++
  }
  return items
}

// ─────────────────────────────────────────────
// PAGE 1 LAYOUT — mirrors _page1_layout
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
// BALANCED SPLIT for centered blocks
// ─────────────────────────────────────────────
function splitCentered(text, threshold = 55) {
  if (!text || text.length <= threshold) return [text]
  const words = text.split(/\s+/)
  const mid   = Math.ceil(words.length / 2)
  return [words.slice(0, mid).join(' '), words.slice(mid).join(' ')]
}

// ─────────────────────────────────────────────
// ATTESTAT PAGE — renders one A4 landscape page
// Positions faithfully mirror pdf_generator.py
// ─────────────────────────────────────────────
function AttestatPage({ student, pageNum, lang, template, items, noTemplate = false }) {
  const l  = getPage1Layout(lang, noTemplate)
  const FS = 8    // font-size pt for grades

  // Resolve display texts
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

  // Centered text block helper — mirrors drawCentredString(x, y, text)
  // Achieves center at centerX by using left = centerX - 200, width = 400
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

  // ── Specialty Y positions (mirrors Python spec_start_y logic) ──
  // spec_start_y = spec_y + LINE_SPACING/2 = spec_y + 6
  // line i CSS top = rl(spec_y + 6) + i*12 + shifts[i]
  //               = rl(spec_y) - 6 + i*12 + shifts[i]
  const specShifts = lang === 'ru' ? [2.5 * MM, 5 * MM] : [3 * MM, 5 * MM]
  // RU line 0: center shifts +15mm to the right to avoid template text overlap
  const specXOff = (lang === 'ru') ? [15 * MM, 0] : [0, 0]

  // ── Qualification Y positions (mirrors Python qual_y_shift logic) ──
  // extra_lines = max(0, total_spec_lines - 2)
  // free_line_up = (12 + 2mm) if spec_lines === 1 else 0
  // qual_y_shift = extra_lines*12 + 12 + 2mm - free_line_up
  const specLineCount = specLines.length
  const extraSpecLines = Math.max(0, specLineCount - 2)
  const freeLineUp     = specLineCount === 1 ? (12 + 2 * MM) : 0
  const qualYShift     = extraSpecLines * 12 + 12 + 2 * MM - freeLineUp

  // qual2 extra offset below qual lines
  // qual2_extra = (qual_lines - 1)*12 + (2mm if qual_lines > 1 else 0)
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
      {/* Background template — preview only */}
      {!noTemplate && (
        <img
          src={template}
          alt=""
          style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'fill' }}
        />
      )}

      {/* ── PAGE 1: student metadata ── */}
      {pageNum === 1 && (
        <>
          {/* Name */}
          <T style={{ left:`${l.name_x}pt`, top:`${rl(l.name_y)}pt`, fontSize:'11pt', fontWeight:'bold', whiteSpace:'nowrap' }}>
            {nameVal}
          </T>

          {/* Document number */}
          <T style={{ left:`${l.doc_x}pt`, top:`${rl(l.doc_y)}pt`, fontSize:'11pt', fontWeight:'bold', whiteSpace:'nowrap' }}>
            {student.document_number || ''}
          </T>

          {/* Years */}
          <T style={{ left:`${l.sx}pt`, top:`${rl(l.sy)}pt`, fontSize:'11pt', fontWeight:'bold' }}>
            {student.start_year || '2023'}
          </T>
          <T style={{ left:`${l.ex}pt`, top:`${rl(l.ey)}pt`, fontSize:'11pt', fontWeight:'bold' }}>
            {student.end_year || '2026'}
          </T>

          {/* Institution — centered at inst_x=210 */}
          <Centered x={l.inst_x} cssTop={rl(l.inst_y)}>
            {instTxt}
          </Centered>

          {/* Specialty lines — Python-faithful Y offsets */}
          {specLines.map((line, i) => {
            const shift  = specShifts[i] ?? specShifts[specShifts.length - 1]
            const cssTop = rl(l.spec_y) - 6 + i * 12 + shift
            return (
              <Centered key={`spec${i}`} x={l.spec_x} xOff={specXOff[i] ?? 0} cssTop={cssTop}>
                {line}
              </Centered>
            )
          })}

          {/* Qualification lines — Python-faithful Y offsets */}
          {qualLines.map((line, i) => {
            const extraDown = i > 0 ? 2 * MM : 0
            const cssTop    = rl(l.qual_y) + qualYShift + i * 12 + extraDown
            return (
              <Centered key={`qual${i}`} x={l.qual_x} cssTop={cssTop}>
                {line}
              </Centered>
            )
          })}

          {/* Qualification suffix */}
          {qual2Txt && (
            <Centered x={l.qual2_x} cssTop={rl(l.qual2_y) + qualYShift + qual2Extra}>
              {qual2Txt}
            </Centered>
          )}
        </>
      )}

      {/* ── GRADES (both pages) ── */}
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

        // Subject row
        return (
          <span key={`s${i}`}>
            {/* Row number */}
            <T style={{ left:`${item.x}pt`, top:`${itemTop}pt`, fontSize:`${FS}pt` }}>
              {item.rowNum}
            </T>

            {/* Subject name (wrapped lines) */}
            {item.lines.map((line, li) => (
              <T key={li} style={{ left:`${item.x + item.subjectOffX}pt`, top:`${itemTop + li * 9}pt`, fontSize:`${FS}pt` }}>
                {line}
              </T>
            ))}

            {/* Hours (centered) */}
            <T style={{ left:`${item.x + item.hoursOffX}pt`, top:`${itemTop}pt`, fontSize:`${FS}pt`, transform:'translateX(-50%)' }}>
              {item.hoursStr}
            </T>

            {/* Credits (centered) */}
            {item.credits && (
              <T style={{ left:`${item.x + item.creditsOffX}pt`, top:`${itemTop}pt`, fontSize:`${FS}pt`, transform:'translateX(-50%)' }}>
                {item.credits}
              </T>
            )}

            {/* Scores or pass label */}
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
// PDF GENERATOR — html2canvas → jsPDF
// Elements must be in DOM but off-screen (not display:none, not inside scale transforms)
// ─────────────────────────────────────────────
async function renderPageToCanvas(el) {
  const imgs = Array.from(el.querySelectorAll('img'))
  await Promise.all(imgs.map(async img => {
    if (!img.complete) await new Promise(r => { img.onload = r; img.onerror = r })
    try { await img.decode() } catch (_) {}
  }))
  return html2canvas(el, { scale: 2, useCORS: true, allowTaint: true, logging: false })
}

// Composite: text canvas (noTemplate, white bg) + template image via multiply blend
// multiply: white areas show through template, black text stays black — perfect overlay
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

  if (!tmplImg) return textCanvas  // fallback: no template

  const out = document.createElement('canvas')
  out.width  = textCanvas.width
  out.height = textCanvas.height
  const ctx  = out.getContext('2d')

  // 1. Draw template stretched to full canvas
  ctx.drawImage(tmplImg, 0, 0, out.width, out.height)

  // 2. Overlay text: multiply removes white bg, keeps dark text
  ctx.globalCompositeOperation = 'multiply'
  ctx.drawImage(textCanvas, 0, 0)

  return out
}

async function generatePdfBlob(page1El, page2El) {
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  const [c1, c2] = await Promise.all([
    renderPageToCanvas(page1El),
    renderPageToCanvas(page2El),
  ])
  pdf.addImage(c1.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, PAGE_W, PAGE_H)
  pdf.addPage([PAGE_W, PAGE_H], 'landscape')
  pdf.addImage(c2.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, PAGE_W, PAGE_H)
  return pdf.output('blob')
}

// ─────────────────────────────────────────────
// SHARED UI COMPONENTS
// ─────────────────────────────────────────────
function GlassCard({ children, className = '' }) {
  return (
    <div className={`rounded-2xl border border-indigo-500/10 bg-slate-800/40 backdrop-blur p-5 shadow-xl ${className}`}>
      {children}
    </div>
  )
}

function StatCard({ number, label }) {
  return (
    <div className="rounded-2xl border border-indigo-500/15 bg-slate-800/40 p-5 text-center hover:-translate-y-1 transition-transform duration-300 group relative overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-indigo-500 via-violet-500 to-purple-400 opacity-0 group-hover:opacity-100 transition-opacity" />
      <div className="text-3xl font-extrabold bg-gradient-to-br from-indigo-400 to-violet-400 bg-clip-text text-transparent">{number}</div>
      <div className="text-xs text-slate-400 uppercase tracking-widest mt-1">{label}</div>
    </div>
  )
}

function Btn({ children, onClick, primary, className = '', disabled }) {
  const base = 'px-4 py-2 rounded-xl font-medium text-sm transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed'
  const v = primary
    ? 'bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-lg hover:shadow-indigo-500/30 hover:-translate-y-0.5'
    : 'border border-indigo-500/20 text-indigo-300 hover:bg-indigo-500/20 hover:border-indigo-500/40'
  return <button onClick={onClick} className={`${base} ${v} ${className}`} disabled={disabled}>{children}</button>
}

// ─────────────────────────────────────────────
// TAB: EDITOR
// ─────────────────────────────────────────────
function TabEditor({ students, setStudents, lang }) {
  const [selIdx, setSelIdx] = useState(0)
  const s = students[selIdx] || {}

  const upd = (field, val) =>
    setStudents(students.map((st, i) => i === selIdx ? { ...st, [field]: val } : st))

  const updSubj = (si, field, val) =>
    upd('subjects_list', s.subjects_list.map((sb, i) => i === si ? { ...sb, [field]: val } : sb))

  const updScore = (si, val) => {
    const g = getGradeInfo(val)
    setStudents(students.map((st, i) => {
      if (i !== selIdx) return st
      return {
        ...st,
        subjects_list: st.subjects_list.map((sb, j) =>
          j === si ? { ...sb, score: val, letter: g.letter, point: g.point } : sb
        ),
      }
    }))
  }

  const updDoc = (val) => {
    const next = [...students]
    next[selIdx] = { ...next[selIdx], document_number: val }
    if (/^\d+$/.test(val)) {
      const base = parseInt(val, 10)
      for (let i = selIdx + 1; i < next.length; i++) {
        const n = String(base + (i - selIdx))
        next[i] = { ...next[i], document_number: val.length > n.length ? n.padStart(val.length, '0') : n }
      }
    }
    setStudents(next)
  }

  const [scale, setScale] = useState(0.55)
  const [busy, setBusy]   = useState(false)
  const [dlStatus, setDlStatus] = useState('')

  if (!students.length) return <p className="text-slate-400 text-center py-10">Нет данных</p>

  const INPUT = 'bg-slate-900 border border-indigo-500/20 text-slate-200 rounded-lg px-3 py-1.5 text-sm w-full focus:outline-none focus:border-indigo-400'

  const items = calculateLayout(s, lang)
  const tmpls = lang === 'ru'
    ? ['/data/template_ru_fixed.jpg', '/data/template_ru_2_fixed.jpg']
    : ['/data/template_kz.jpg',       '/data/template_kz_2.jpg']

  const previewW = PAGE_W * scale
  const previewH = (PAGE_H * 2 + 10) * scale

  const dlWithTemplate = async () => {
    setBusy(true); setDlStatus('Генерация...')
    try {
      // Use fresh createRoot container (same as dlAll) to avoid getBoundingClientRect
      // offset issues with persistent fixed elements — ensures correct text positions
      const container = document.createElement('div')
      container.style.cssText = `position:fixed;left:-9999px;top:0;z-index:-1;width:${PAGE_W}pt;`
      document.body.appendChild(container)

      const root = createRoot(container)
      await new Promise(res => {
        root.render(
          <div>
            <AttestatPage student={s} pageNum={1} lang={lang} template={tmpls[0]} items={items} noTemplate />
            <AttestatPage student={s} pageNum={2} lang={lang} template={tmpls[1]} items={items} noTemplate />
          </div>
        )
        // Short settle — no images (noTemplate), just React layout
        setTimeout(res, 150)
      })

      const pages = container.querySelectorAll('.attestat-page')
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
      const [c1, c2] = await Promise.all([
        renderPageToCanvasComposite(pages[0], tmpls[0]),
        renderPageToCanvasComposite(pages[1], tmpls[1]),
      ])

      root.unmount()
      document.body.removeChild(container)

      pdf.addImage(c1.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, PAGE_W, PAGE_H)
      pdf.addPage([PAGE_W, PAGE_H], 'landscape')
      pdf.addImage(c2.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, PAGE_W, PAGE_H)
      const blob = pdf.output('blob')
      const url  = URL.createObjectURL(blob)
      Object.assign(document.createElement('a'), {
        href: url,
        download: `${s.name_kz || s.full_name || 'attestat'}_шаблон.pdf`,
      }).click()
      URL.revokeObjectURL(url)
      setDlStatus('✅ Готово!')
    } catch (e) {
      setDlStatus('❌ ' + e.message)
    }
    setBusy(false)
  }

  return (
    <div className="flex flex-col lg:flex-row gap-5 lg:items-start">

      {/* ── LEFT: editor panel 50% ── */}
      <div className="w-full lg:w-1/2 min-w-0 space-y-4">
        <select
          className="w-full bg-slate-800 border border-indigo-500/20 text-indigo-200 rounded-xl px-3 py-2 text-sm focus:outline-none"
          value={selIdx}
          onChange={e => setSelIdx(+e.target.value)}
        >
          {students.map((st, i) => <option key={i} value={i}>{i + 1}. {st.full_name}</option>)}
        </select>

        <GlassCard>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            {[['name_kz','ФИО (KZ)'],['name_ru','ФИО (RU)']].map(([f,lbl]) => (
              <label key={f} className="flex flex-col gap-1">
                <span className="text-xs text-indigo-300 font-medium">{lbl}</span>
                <input className={INPUT} value={s[f] || ''} onChange={e => upd(f, e.target.value)} />
              </label>
            ))}
            <label className="flex flex-col gap-1">
              <span className="text-xs text-indigo-300 font-medium">№ документа</span>
              <input className={INPUT} value={s.document_number || ''} onChange={e => updDoc(e.target.value)} />
            </label>
          </div>

          <details className="group">
            <summary className="cursor-pointer text-sm text-indigo-300 font-medium py-1 select-none list-none flex items-center gap-2">
              <span className="transition-transform group-open:rotate-90 inline-block">▶</span>
              Данные организации и специальности
            </summary>
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                ['institution','Организация KZ','ta'],
                ['specialty','Специальность KZ','ta'],
                ['qualification','Квалификация KZ','inp'],
                ['qualification_2','Квалификация KZ (стр 2)','inp'],
                ['institution_ru','Организация RU','ta'],
                ['specialty_ru','Специальность RU','ta'],
                ['qualification_ru','Квалификация RU','inp'],
                ['qualification_2_ru','Квалификация RU (стр 2)','inp'],
              ].map(([f,lbl,t]) => (
                <label key={f} className="flex flex-col gap-1">
                  <span className="text-xs text-indigo-300 font-medium">{lbl}</span>
                  {t === 'ta'
                    ? <textarea rows={2} className={`${INPUT} resize-none`} value={s[f] || ''} onChange={e => upd(f, e.target.value)} />
                    : <input className={INPUT} value={s[f] || ''} onChange={e => upd(f, e.target.value)} />
                  }
                </label>
              ))}
            </div>
          </details>
        </GlassCard>

        <GlassCard>
          <h4 className="text-indigo-300 font-semibold text-sm mb-3">
            Предметы ({(s.subjects_list || []).length})
          </h4>
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-900">
                <tr className="text-slate-400 border-b border-indigo-500/10">
                  <th className="text-left py-2 px-2">Предмет</th>
                  <th className="py-2 px-2 w-14">Часы</th>
                  <th className="py-2 px-2 w-14">Балл</th>
                  <th className="py-2 px-2 w-14">Тамға</th>
                  <th className="py-2 px-2 w-14">GPA</th>
                </tr>
              </thead>
              <tbody>
                {(s.subjects_list || []).map((sb, si) => (
                  <tr key={si} className="border-b border-indigo-500/5 hover:bg-indigo-500/5">
                    <td className="py-1 px-2 text-slate-400 text-xs">
                      {sb.module ? `[${sb.module.slice(0, 20)}] ` : ''}
                      <input
                        className="bg-transparent text-slate-300 w-48 focus:outline-none"
                        value={sb.name_kz || ''}
                        onChange={e => updSubj(si, 'name_kz', e.target.value)}
                      />
                    </td>
                    <td className="py-1 px-2 text-center">
                      <input className="bg-transparent text-slate-300 w-10 text-center focus:outline-none" value={sb.hours || ''} onChange={e => updSubj(si, 'hours', e.target.value)} />
                    </td>
                    <td className="py-1 px-2 text-center">
                      <input className="bg-transparent text-slate-300 w-10 text-center focus:outline-none" value={sb.score || ''} onChange={e => updScore(si, e.target.value)} />
                    </td>
                    <td className="py-1 px-2 text-center text-slate-400">{sb.letter}</td>
                    <td className="py-1 px-2 text-center text-slate-400">{sb.point}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </GlassCard>
      </div>

      {/* ── RIGHT: preview 50% + download ── */}
      <div className="w-full lg:w-1/2 lg:sticky lg:top-0 lg:max-h-screen lg:overflow-y-auto space-y-3">
        <GlassCard className="!p-3">
          {/* Zoom controls */}
          <div className="flex items-center justify-between mb-2 px-1 select-none">
            <p className="text-xs text-slate-400 font-medium">
              Предпросмотр <span className="text-slate-600">· {Math.round(scale * 100)}%</span>
            </p>
            <div className="flex items-center gap-1">
              <button onClick={() => setScale(v => Math.max(0.2, +(v - 0.1).toFixed(1)))}
                className="w-6 h-6 rounded text-slate-400 hover:bg-indigo-500/20 hover:text-indigo-300 text-sm leading-none cursor-pointer">−</button>
              <button onClick={() => setScale(v => Math.min(1.5, +(v + 0.1).toFixed(1)))}
                className="w-6 h-6 rounded text-slate-400 hover:bg-indigo-500/20 hover:text-indigo-300 text-sm leading-none cursor-pointer">+</button>
            </div>
          </div>

          {/* Scaled preview */}
          <div className="overflow-auto max-h-[55vh]">
            <div style={{ width: `${previewW}pt`, height: `${previewH}pt`, overflow: 'hidden', position: 'relative' }}>
              <div style={{
                transform: `scale(${scale})`,
                transformOrigin: 'top left',
                width: `${PAGE_W}pt`,
                display: 'flex',
                flexDirection: 'column',
                gap: '10pt',
              }}>
                <AttestatPage student={s} pageNum={1} lang={lang} template={tmpls[0]} items={items} />
                <AttestatPage student={s} pageNum={2} lang={lang} template={tmpls[1]} items={items} />
              </div>
            </div>
          </div>

          {/* Download with template */}
          <div className="mt-3 pt-3 border-t border-indigo-500/10 flex items-center gap-3 px-1">
            <Btn primary onClick={dlWithTemplate} disabled={busy} className="flex-1">
              ⬇ Скачать с шаблоном
            </Btn>
            {dlStatus && <span className="text-xs text-indigo-300 shrink-0">{dlStatus}</span>}
          </div>
        </GlassCard>

      </div>

    </div>
  )
}

// ─────────────────────────────────────────────
// TAB: GENERATE
// ─────────────────────────────────────────────
function TabGenerate({ students, lang }) {
  const [selIdx, setSelIdx]     = useState(0)
  const [status, setStatus]     = useState('')
  const [progress, setProgress] = useState(0)
  const [busy, setBusy]         = useState(false)

  const student = students[selIdx] || {}
  const items   = students.length ? calculateLayout(student, lang) : []
  const tmpls   = lang === 'ru'
    ? ['/data/template_ru_fixed.jpg', '/data/template_ru_2_fixed.jpg']
    : ['/data/template_kz.jpg',       '/data/template_kz_2.jpg']

  const dlOne = async () => {
    setBusy(true); setStatus('Генерация PDF...')
    try {
      // Fresh createRoot container — avoids getBoundingClientRect offset issues
      const container = document.createElement('div')
      container.style.cssText = `position:fixed;left:-9999px;top:0;z-index:-1;width:${PAGE_W}pt;`
      document.body.appendChild(container)

      const root = createRoot(container)
      await new Promise(res => {
        root.render(
          <div>
            <AttestatPage student={student} pageNum={1} lang={lang} template={tmpls[0]} items={items} noTemplate />
            <AttestatPage student={student} pageNum={2} lang={lang} template={tmpls[1]} items={items} noTemplate />
          </div>
        )
        setTimeout(res, 150)
      })

      const pages = container.querySelectorAll('.attestat-page')
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
      const [c1, c2] = await Promise.all([
        renderPageToCanvas(pages[0]),
        renderPageToCanvas(pages[1]),
      ])
      root.unmount()
      document.body.removeChild(container)

      pdf.addImage(c1.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, PAGE_W, PAGE_H)
      pdf.addPage([PAGE_W, PAGE_H], 'landscape')
      pdf.addImage(c2.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, PAGE_W, PAGE_H)
      const blob = pdf.output('blob')
      const url  = URL.createObjectURL(blob)
      Object.assign(document.createElement('a'), {
        href: url,
        download: `${student.name_kz || student.full_name || 'attestat'}.pdf`,
      }).click()
      URL.revokeObjectURL(url)
      setStatus('✅ Готово!')
    } catch (e) {
      setStatus('❌ ' + e.message)
    }
    setBusy(false)
  }

  const dlAll = async () => {
    setBusy(true); setProgress(0)
    const zip = new JSZip()

    for (let i = 0; i < students.length; i++) {
      setStatus(`Генерация ${i + 1} / ${students.length}...`)
      setProgress(Math.round((i / students.length) * 100))

      const s   = students[i]
      const it  = calculateLayout(s, lang)

      // Render off-screen at full A4 size
      const container = document.createElement('div')
      container.style.cssText = 'position:fixed;left:-9999px;top:0;z-index:-1;width:' + PAGE_W + 'pt;'
      document.body.appendChild(container)

      const root = createRoot(container)
      await new Promise(res => {
        root.render(
          <div>
            <AttestatPage student={s} pageNum={1} lang={lang} template={tmpls[0]} items={it} noTemplate />
            <AttestatPage student={s} pageNum={2} lang={lang} template={tmpls[1]} items={it} noTemplate />
          </div>
        )
        // No images to wait for (noTemplate), short settle time
        setTimeout(res, 100)
      })

      const pages = container.querySelectorAll('.attestat-page')
      if (pages.length >= 2) {
        const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
        const [c1, c2] = await Promise.all([
          renderPageToCanvas(pages[0]),
          renderPageToCanvas(pages[1]),
        ])
        pdf.addImage(c1.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, PAGE_W, PAGE_H)
        pdf.addPage([PAGE_W, PAGE_H], 'landscape')
        pdf.addImage(c2.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, PAGE_W, PAGE_H)
        const safeName = (s.name_kz || s.full_name || `student_${i + 1}`)
          .replace(/[/\\?%*:|"<>]/g, '_')
        zip.file(`${safeName}.pdf`, pdf.output('blob'))
      }

      root.unmount()
      document.body.removeChild(container)
    }

    setProgress(100)
    const blob = await zip.generateAsync({ type: 'blob' })
    const url  = URL.createObjectURL(blob)
    Object.assign(document.createElement('a'), { href: url, download: 'attestaty.zip' }).click()
    URL.revokeObjectURL(url)
    setStatus(`✅ Архив: ${students.length} аттестатов`)
    setBusy(false)
  }

  const [scale, setScale] = useState(1.0)

  if (!students.length) return <p className="text-slate-400 text-center py-10">Нет данных</p>

  const previewW = PAGE_W * scale
  const previewH = (PAGE_H * 2 + 10) * scale

  return (
    <div className="space-y-4">
      {/* ── Controls ── */}
      <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-3">
        <select
          className="w-full sm:flex-1 sm:min-w-52 bg-slate-800 border border-indigo-500/20 text-indigo-200 rounded-xl px-3 py-2 text-sm focus:outline-none"
          value={selIdx}
          onChange={e => { setSelIdx(+e.target.value); setStatus('') }}
        >
          {students.map((s, i) => <option key={i} value={i}>{i + 1}. {s.full_name}</option>)}
        </select>
        <div className="flex gap-2 flex-wrap">
          <Btn primary onClick={dlOne} disabled={busy} className="flex-1 sm:flex-none">⬇ Скачать PDF</Btn>
          <Btn onClick={dlAll} disabled={busy} className="flex-1 sm:flex-none">📦 Все ({students.length}) ZIP</Btn>
          <Btn onClick={() => window.print()} disabled={busy} className="flex-1 sm:flex-none">🖨 Печать</Btn>
        </div>
        {status && <span className="text-xs text-indigo-300 w-full sm:w-auto">{status}</span>}
      </div>

      {/* Progress bar */}
      {busy && progress > 0 && progress < 100 && (
        <div className="w-full bg-slate-700 rounded-full h-1.5">
          <div
            className="bg-gradient-to-r from-indigo-500 to-violet-500 h-1.5 rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {/* ── Preview (scaled, visual only) ── */}
      <GlassCard className="overflow-auto">
        <div className="flex items-center justify-between mb-3 select-none">
          <p className="text-xs text-slate-500">Предпросмотр · {Math.round(scale * 100)}%</p>
          <div className="flex items-center gap-1">
            <button onClick={() => setScale(v => Math.max(0.2, +(v - 0.1).toFixed(1)))}
              className="w-6 h-6 rounded text-slate-400 hover:bg-indigo-500/20 hover:text-indigo-300 text-sm leading-none cursor-pointer">−</button>
            <button onClick={() => setScale(v => Math.min(1.0, +(v + 0.1).toFixed(1)))}
              className="w-6 h-6 rounded text-slate-400 hover:bg-indigo-500/20 hover:text-indigo-300 text-sm leading-none cursor-pointer">+</button>
          </div>
        </div>
        {/* Wrapper shrinks to scaled dimensions so card height is correct */}
        <div style={{ width: `${previewW}pt`, height: `${previewH}pt`, overflow: 'hidden', position: 'relative' }}>
          <div style={{
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            width: `${PAGE_W}pt`,
            display: 'flex',
            flexDirection: 'column',
            gap: '10pt',
          }}>
            <AttestatPage student={student} pageNum={1} lang={lang} template={tmpls[0]} items={items} />
            <AttestatPage student={student} pageNum={2} lang={lang} template={tmpls[1]} items={items} />
          </div>
        </div>
      </GlassCard>

      {/* Hidden print area — no template */}
      <div id="print-area" style={{ display: 'none' }}>
        <AttestatPage student={student} pageNum={1} lang={lang} template={tmpls[0]} items={items} noTemplate />
        <AttestatPage student={student} pageNum={2} lang={lang} template={tmpls[1]} items={items} noTemplate />
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────
export default function App() {
  const [students, setStudents] = useState([])
  const [lang, setLang]         = useState('kz')
  const [tab, setTab]           = useState('editor')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 768 : true
  )
  const fileRef = useRef(null)

  const handleFile = useCallback(async (file) => {
    if (!file) return
    setLoading(true); setError('')
    try {
      const parsed = parseExcel(await file.arrayBuffer())
      if (!parsed.length) throw new Error('Студенты не найдены — проверьте структуру .xlsx')
      setStudents(parsed); setTab('editor')
    } catch (e) {
      setError(e.message || 'Ошибка чтения файла')
    }
    setLoading(false)
  }, [])

  const totalSubjs = students[0]?.subjects_list?.length || 0
  const totalMods  = new Set(students[0]?.subjects_list?.map(s => s.module) || []).size

  const TABS = [['editor','Редактор данных'],['generate','Генерация PDF']]

  return (
    <>
      <div id="app-ui" className="flex min-h-screen">

        {/* ── MOBILE BACKDROP ── */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/60 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* ── SIDEBAR ── */}
        <aside className={`
          ${sidebarOpen
            ? 'fixed inset-y-0 left-0 z-50 w-72 md:relative md:inset-auto md:z-auto md:w-60'
            : 'hidden md:flex md:w-12'}
          shrink-0 bg-gradient-to-b from-gray-950 via-slate-900 to-gray-950 border-r border-indigo-500/15 flex flex-col transition-all duration-200 overflow-hidden
        `}>
          {/* Header row: logo + toggle */}
          <div className={`flex items-center ${sidebarOpen ? 'justify-between p-5 pb-0' : 'justify-center pt-4'}`}>
            {sidebarOpen && (
              <div className="flex items-center gap-3">
                <img
                  src="/logo.png"
                  alt=""
                  className="w-9 h-9 rounded-full object-contain bg-indigo-500/10 p-1 border border-indigo-500/20"
                  onError={e => e.target.style.display = 'none'}
                />
                <div>
                  <div className="text-xs font-bold text-indigo-300">Atestat Generator</div>
                  <div className="text-[10px] text-slate-500">УГТК · v2.0</div>
                </div>
              </div>
            )}
            <button
              onClick={() => setSidebarOpen(v => !v)}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:bg-indigo-500/20 hover:text-indigo-300 transition-all cursor-pointer text-sm"
              title={sidebarOpen ? 'Свернуть' : 'Развернуть'}
            >
              {sidebarOpen ? '◀' : '▶'}
            </button>
          </div>

          {sidebarOpen && (
            <div className="flex flex-col gap-5 p-5 flex-1 overflow-y-auto">
              <hr className="border-indigo-500/15" />

              {/* Language toggle */}
              <div>
                <p className="text-[10px] font-semibold text-indigo-400 mb-2 uppercase tracking-wider">Версия документа</p>
                <div className="flex gap-2">
                  {[['kz','Қазақша'],['ru','Русская']].map(([v, l]) => (
                    <button
                      key={v}
                      onClick={() => setLang(v)}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                        lang === v
                          ? 'bg-indigo-500/30 text-indigo-200 border-indigo-400/40'
                          : 'border-indigo-500/15 text-slate-400 hover:bg-indigo-500/10'
                      }`}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </div>

              {/* File upload */}
              <div>
                <p className="text-[10px] font-semibold text-indigo-400 mb-2 uppercase tracking-wider">Excel файл</p>
                <div
                  className="border-2 border-dashed border-indigo-500/25 rounded-xl p-4 text-center cursor-pointer hover:border-indigo-500/50 hover:bg-indigo-500/5 transition-all"
                  onClick={() => fileRef.current?.click()}
                  onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files?.[0]) }}
                  onDragOver={e => e.preventDefault()}
                >
                  <div className="text-2xl float-icon">📂</div>
                  <p className="text-[11px] text-slate-400 mt-1">Нажмите или перетащите .xlsx</p>
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx"
                  className="hidden"
                  onChange={e => handleFile(e.target.files?.[0])}
                />
              </div>

              {error && (
                <p className="text-red-400 text-xs bg-red-500/10 rounded-lg p-2 border border-red-500/20">{error}</p>
              )}

              {students.length > 0 && (
                <>
                  <hr className="border-indigo-500/15" />
                  <button
                    onClick={() => { setStudents([]); setTab('editor') }}
                    className="w-full py-2 rounded-xl text-xs border border-indigo-500/20 text-indigo-300 hover:bg-indigo-500/15 transition-all cursor-pointer"
                  >
                    🔄 Сбросить данные
                  </button>
                </>
              )}

              <div className="mt-auto text-center text-[10px] text-indigo-500/30 tracking-widest">✦ УГТК ✦</div>
            </div>
          )}
        </aside>

        {/* ── MAIN ── */}
        <main className="flex-1 flex flex-col overflow-hidden">
          <header className="grad-header px-4 md:px-6 py-3 md:py-4 flex items-center gap-3 border-b border-indigo-500/10">
            {/* Hamburger — visible on mobile when sidebar is closed */}
            <button
              onClick={() => setSidebarOpen(v => !v)}
              className="md:hidden w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-indigo-500/20 hover:text-indigo-300 transition-all cursor-pointer shrink-0 text-base"
              aria-label="Меню"
            >
              ☰
            </button>
            <div className="min-w-0">
              <h1 className="text-base md:text-lg font-extrabold bg-gradient-to-r from-white to-indigo-200 bg-clip-text text-transparent leading-tight truncate">
                ✨ Генератор Аттестатов
              </h1>
              <p className="text-[10px] md:text-[11px] text-indigo-200/60 mt-0.5 truncate">
                Уральский гуманитарно-технический колледж · Автоматическое создание PDF
              </p>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 md:space-y-5">

            {!students.length && !loading && (
              <div className="max-w-md mx-auto mt-12 text-center fade-in-up">
                <div className="text-6xl float-icon mb-4">🎓</div>
                <h2 className="text-2xl font-bold text-slate-200 mb-2">Добро пожаловать</h2>
                <p className="text-slate-400 mb-2">Загрузите Excel файл в боковой панели</p>
                <p className="text-xs text-indigo-500/50">Поддерживается формат .xlsx</p>
              </div>
            )}

            {loading && (
              <div className="text-center py-20">
                <div className="text-5xl float-icon mb-3">⏳</div>
                <p className="text-indigo-300">Чтение Excel файла...</p>
              </div>
            )}

            {students.length > 0 && (
              <>
                <div className="grid grid-cols-3 gap-3 md:gap-4 fade-in-up">
                  <StatCard number={students.length} label="Студентов" />
                  <StatCard number={totalSubjs}      label="Предметов" />
                  <StatCard number={totalMods}       label="Модулей"   />
                </div>

                <div className="flex gap-2 p-1.5 bg-slate-900/60 rounded-2xl border border-indigo-500/10 w-fit">
                  {TABS.map(([id, lbl]) => (
                    <button
                      key={id}
                      onClick={() => setTab(id)}
                      className={`px-5 py-2 rounded-xl text-sm font-medium transition-all cursor-pointer ${
                        tab === id
                          ? 'bg-gradient-to-r from-indigo-500/25 to-violet-500/20 text-white border border-indigo-500/30'
                          : 'text-slate-400 hover:text-indigo-300 hover:bg-indigo-500/10'
                      }`}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>

                {tab === 'editor'   && <TabEditor   students={students} setStudents={setStudents} lang={lang} />}
                {tab === 'generate' && <TabGenerate students={students} lang={lang} />}
              </>
            )}
          </div>
        </main>
      </div>
    </>
  )
}
