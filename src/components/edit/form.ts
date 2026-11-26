// The editor's script (/<id>/edit/, D86, D87, and /edit/new/<table>/, D91): reads the form into a proposal (src/Proposal.ts), marks
// each changed row so it shows its evidence, and keeps the receipt at the side up to date: the
// changeset's TOML with only the changes that are ready, and a total line saying what the rest need.
// On submit it opens the prefilled GitHub issue with the ready changes, after a word in the page if
// some aren't ready, or, over the length a link can carry, shows the changeset to copy (D56). It copies
// a draft link, #draft=, with the form's state, ready or not, which it restores on load (D87): to finish
// later, to pass on, or to open the proposal in a browser that's signed in to GitHub (D90). The DPI test is never worked out again
// here, so the criteria can't be tried out against the form (editor/README.md).
// The rules are the check's (checkProposal, D89). A row's error shows in the line kept for it under
// its input, when the person leaves the input or tries to send, never while they type, and goes as soon
// as the input is right. A reason stops at 500 characters, counted as a person counts them, with a quiet
// counter near the end. Over the length a link can carry, sending is one action: copy the changeset and
// open the blank form to paste it into (D56); over the size accepting takes, it can't be sent (D88, D89).
// Sources are optional: a change is ready with an allowed value, a reason and a real date, and a source
// box that's filled in must hold a link (D90).
// A new system's form (D91, startNew in ./newSystem.ts, which gives this the spec for the place) is the same
// form with every field empty and a top section, `create`, for the reason for adding it: the proposal needs
// that and at least one field, and its draft link also keeps the place.
// Recheck mode (D94, ./recheck.ts) is the form's `data-recheck`, switched by the Edit | Recheck control and `?recheck`; it decides which rows show
// the "Still true" checkbox, `data-slot` on a row, and a confirmed row keeps its checkbox in either mode.
import {
  checkProposal, cleanSources, decodeDraft, encodeDraft, firstGraphemes, graphemeCount, issueLink, joinParts, localDate, MAX_REASON, notReadyText,
  NOT_FOUND, proposalTOMLParts, readiness, readyText, sendReadyText, sizeProblem, splitParts, totalLine,
  type CreateEdit, type EditSpec, type FieldEdit, type FieldSpec, type Problem, type Proposal, type Readiness, type RemoveEdit
} from '../../Proposal.ts'
import { notFoundAfterTyping } from './notFound.ts'
import { canConfirm, hasConfirmations, recheckInSearch, searchWithRecheck, slotOf } from './recheck.ts'

/** Where a row asks for each part of a change, to focus what it still needs */
const inputFor: Record<NonNullable<Problem['about']>, string> = {
  value: 'input[name^="v-"]:checked, input[name^="v-"]:not(:disabled), input[data-remove]', reason: 'textarea[data-reason]', sources: 'input[data-source]', as_of: 'input[data-as-of]', duplicate_of: 'input[data-replacement]'
}

/**
 * One change's TOML as lines of spans, for the receipt: comments muted, keys and brackets grey, values
 * ink. It reads the lines changesetText writes, and proposalTOML's `# was` comments after a value.
 */
function tomlSpans (text: string): Node[] {
  // tonal, in zinc only: values in ink, keys and comments a step lighter (comments in italic), and the
  // punctuation (=, [[changes]], brackets) lightest, so what was proposed stands out
  const span = (className: string, textContent: string) => Object.assign(document.createElement('span'), { className, textContent })
  const key = 'text-muted', punct = 'text-faint', value = 'text-ink', comment = 'text-muted italic'
  const nodes: Node[] = []
  let multiline = false
  for (const line of text.replace(/\n$/, '').split('\n')) {
    const [, name, rhs, note] = line.match(/^([\w.-]+) = (.*?)( {2}# (?:was ".*"|unchanged))?$/) ?? []
    if (multiline || /^ {2}"/.test(line)) nodes.push(span(value, line))
    else if (line.startsWith('#')) nodes.push(span(comment, line))
    else if (name) {
      nodes.push(span(key, name), span(punct, ' = '), span(['[', '"""'].includes(rhs) ? punct : value, rhs))
      if (note) nodes.push(span(comment, note))
    } else nodes.push(span(punct, line))
    // a reason over several lines, from """ to """
    if ((line.match(/"""/g) ?? []).length % 2) multiline = !multiline
    nodes.push(document.createTextNode('\n'))
  }
  return nodes
}

const all = <E extends Element = HTMLInputElement>(root: ParentNode, selector: string) => [...root.querySelectorAll<E>(selector)]

/** The part of a change an input is for, as a problem's `about` */
function aboutOf (input: Element): Problem['about'] | undefined {
  if (input.matches('textarea[data-reason]')) return 'reason'
  if (input.matches('input[data-source]')) return 'sources'
  if (input.matches('input[data-as-of]')) return 'as_of'
  if (input.matches('input[data-replacement]')) return 'duplicate_of'
  if (input.matches('input[name^="v-"], input[data-not-found]')) return 'value'
}

/** Send the clipboard `text`: whether it worked */
const clipboard = (text: string): Promise<boolean> => {
  try {
    return navigator.clipboard.writeText(text).then(() => true, () => false)
  } catch {
    return Promise.resolve(false)
  }
}

/** Open a link in a new tab, or here if the browser won't */
function openTab (url: string) {
  const tab = window.open(url, '_blank')
  if (tab) tab.opener = null
  else location.href = url
}

export function startEditor (form: HTMLFormElement, forSpec?: EditSpec) {
  const spec: EditSpec = forSpec ?? JSON.parse(form.dataset.spec ?? '{}')
  const today = localDate()
  const row = (id: string) => form.querySelector<HTMLElement>(`[data-field="${CSS.escape(id)}"]`)!
  const panel = document.getElementById('proposal')!
  const part = <E extends Element = HTMLElement>(name: string) => panel.querySelector<E>(`[data-${name}]`)!
  const submit = panel.querySelector<HTMLButtonElement>('button[type=submit]')!
  let sent = false
  // the proposal's problems, as the form is now
  let problems: Problem[] = []
  // the errors shown under the inputs, by `<field> <about>`: one is shown when its input is left, or on
  // trying to send, and stays, as it was, while the person types, until the input is right (D89)
  const shown = new Map<string, string>()
  const slot = (field: string, about: string) => `${field} ${about}`
  const problemFor = (level: Problem['level'], field: string, about: string) => problems.find(problem => problem.level === level && problem.field === field && (problem.about ?? 'value') === about)

  const template = document.querySelector<HTMLTemplateElement>('template#evidence')!

  // the reason's hint, which a confirmation changes (D92): Evidence.astro's, and what ticking "Still true" asks
  const reasonPlaceholder = template.content.querySelector('textarea')!.placeholder
  const stillTruePlaceholder = 'How you checked it is still true, and where'

  /** A row's evidence inputs (Evidence.astro), copied in from the template the first time they're needed */
  function evidenceIn (el: HTMLElement) {
    const box = el.querySelector<HTMLElement>('[data-evidence]')!
    if (box.firstElementChild) return box
    const copy = template.content.cloneNode(true) as DocumentFragment
    // each id in a list, like aria-describedby's
    const prefix = (ids: string) => ids.replace(/(^|\s)ev-/g, `$1${el.dataset.field}-`)
    for (const node of all<HTMLElement>(copy, '[id]')) node.id = prefix(node.id)
    for (const name of ['aria-labelledby', 'aria-describedby']) {
      for (const node of all<HTMLElement>(copy, `[${name}]`)) node.setAttribute(name, prefix(node.getAttribute(name)!))
    }
    if (box.dataset.placeholder) copy.querySelector('textarea')!.placeholder = box.dataset.placeholder
    // the evidence date defaults to today, where the person is (D85)
    copy.querySelector<HTMLInputElement>('input[data-as-of]')!.value = today
    box.append(copy)
    return box
  }

  /** Another source box after a row's last one: a row starts with one */
  function addSource (el: HTMLElement) {
    const last = all(el, 'input[data-source]').at(-1)!
    const input = Object.assign(last.cloneNode() as HTMLInputElement, { value: '' })
    input.setAttribute('aria-label', 'Another source')
    last.after(input)
    return input
  }

  /** A field's value as the form has it, or its current value if the form leaves it as it was */
  function valueOf (field: FieldSpec): string {
    const el = row(field.id)
    if (field.control === 'choice') return el.querySelector<HTMLInputElement>('input[type=radio]:checked')?.value ?? field.current
    if (field.control === 'multi') {
      const ticked = all(el, 'input[type=checkbox][name^="v-"]:checked').map(input => input.value)
      // ticks the same as at the start leave an older, unlisted value as it was
      const value = joinParts(field, ticked)
      return value === joinParts(field, splitParts(field, field.current)) ? field.current : value
    }
    if (el.querySelector<HTMLInputElement>('input[data-not-found]')?.checked) return NOT_FOUND
    const value = el.querySelector<HTMLInputElement>('input[type=text][name^="v-"]')!.value.trim()
    // an empty box over NA leaves it NA, and spaces around the value aren't a change
    return (value === '' && spec.missing.includes(field.current)) || value === field.current.trim() ? field.current : value
  }

  function evidenceOf (row: HTMLElement) {
    const el = evidenceIn(row)
    return {
      reason: el.querySelector<HTMLTextAreaElement>('textarea[data-reason]')!.value,
      sources: cleanSources(all(el, 'input[data-source]').map(input => input.value)),
      as_of: el.querySelector<HTMLInputElement>('input[data-as-of]')!.value
    }
  }

  function read (): Proposal {
    const edits: FieldEdit[] = []
    for (const field of spec.fields) {
      const el = row(field.id)
      const value = valueOf(field)
      // a confirmation (D92) keeps the value, which is then a change with its evidence. Changing the value makes it an ordinary edit
      if (value !== field.current) el.removeAttribute('data-confirmed')
      const confirming = value === field.current && el.hasAttribute('data-confirmed')
      const changed = value !== field.current || confirming
      el.toggleAttribute('data-changed', changed)
      el.toggleAttribute('data-confirming', confirming)
      // Undo or the "Still true" checkbox (D94), and the checkbox as ticked as the row is confirmed
      el.dataset.slot = slotOf({ canConfirm: canConfirm(field, spec.isNew), recheck: form.hasAttribute('data-recheck'), changed, confirming })
      const box = el.querySelector<HTMLInputElement>('input[data-confirm]')
      if (box) box.checked = confirming
      if (changed) {
        const evidence = evidenceOf(el)
        const reason = el.querySelector<HTMLTextAreaElement>('textarea[data-reason]')!
        reason.placeholder = confirming ? stillTruePlaceholder : el.querySelector<HTMLElement>('[data-evidence]')!.dataset.placeholder ?? reasonPlaceholder
        edits.push({ field: field.id, value, ...(confirming ? { confirmed: true } : {}), ...evidence })
      }
    }
    // a new system's top section: the reason for adding it, which it always has (D91)
    if (spec.isNew) return { create: evidenceOf(row('create')), edits }
    const removal = row('remove')
    const removing = removal.querySelector<HTMLInputElement>('input[data-remove]')!.checked
    removal.toggleAttribute('data-changed', removing)
    const replacement = removal.querySelector<HTMLInputElement>('input[data-replacement]')!.value.trim()
    return removing ? { edits, remove: { ...evidenceOf(removal), ...(replacement ? { duplicate_of: replacement } : {}) } } : { edits }
  }

  /** Whether the person has put anything in the form: a field, or a reason or source for adding a new system, which the date alone isn't */
  const touched = (proposal: Proposal) => proposal.edits.length > 0 || proposal.remove !== undefined || (proposal.create !== undefined && (proposal.create.reason.trim() !== '' || proposal.create.sources.length > 0))

  /** Show the error for a part of a row, if it has one: when its input is left, or on trying to send */
  function reveal (field: string, about: string) {
    const error = problemFor('error', field, about)
    if (error) shown.set(slot(field, about), error.hint ?? error.message)
  }

  /**
   * Each row's lines under its inputs: an error that's shown, until its input is right, or else a
   * warning, like a later date, which shows at once, as it doesn't stop anything. The lines keep their
   * space, so nothing moves (D89).
   */
  function showProblems () {
    for (const el of all<HTMLElement>(form, '[data-field]')) {
      const field = el.dataset.field!
      for (const line of all<HTMLElement>(el, '[data-error]')) {
        const about = line.dataset.error!
        if (!problemFor('error', field, about)) shown.delete(slot(field, about))
        const error = shown.get(slot(field, about))
        const warning = error === undefined ? problemFor('warning', field, about) : undefined
        line.textContent = error ?? warning?.hint ?? warning?.message ?? ''
        line.dataset.level = error !== undefined ? 'error' : warning ? 'warning' : ''
        for (const input of all<HTMLElement>(el, `[aria-describedby~="${CSS.escape(line.id)}"]`)) {
          if (error !== undefined) input.setAttribute('aria-invalid', 'true')
          else input.removeAttribute('aria-invalid')
        }
      }
    }
  }

  /**
   * The receipt: the changeset's TOML with the ready changes only, as it will be sent, each a link to
   * its row; the total line; and the buttons, which need a ready change, and the panel's own problems,
   * like changing values and removing the system at once
   */
  function showReceipt (proposal: Proposal, state: Readiness) {
    const { header, changes } = proposalTOMLParts(spec, state.ready)
    const body = part('receipt-body')
    const title = (field: string) => state.changes.find(change => change.field === field)?.title ?? field
    body.replaceChildren(
      Object.assign(document.createElement('p'), { className: 'w-max min-w-full px-4 pb-2 text-muted whitespace-pre', textContent: header }),
      ...changes.map(change => {
        const link = Object.assign(document.createElement('a'), {
          href: `#f-${change.field}`, title: `Go to ${title(change.field)} in the form`,
          className: 'block w-max min-w-full px-4 py-2 border-t border-dashed border-line-strong whitespace-pre hover:bg-zinc-50'
        })
        link.dataset.goto = change.field
        link.append(...tomlSpans(change.text))
        return link
      })
    )
    body.hidden = !changes.length
    part('total').textContent = totalLine(state)
    part('ready').textContent = readyText(state)
    const count = changes.length
    // problems that aren't about one change, like changing values and removing the system at once, which
    // the total line names, so the panel says only what to do; and a proposal too large to accept (D89)
    const general = problems.filter(problem => problem.level === 'error' && !problem.field && state.changes.length)
    const size = count ? sizeProblem(spec, state.ready) : undefined
    const notes = [...general, ...(size ? [size] : [])]
    part('problems').replaceChildren(...notes.map(problem => Object.assign(document.createElement('li'), {
      textContent: problem.hint ?? problem.message, className: problem.level === 'warning' ? 'text-amber-800' : ''
    })))
    part('problems').hidden = !notes.length
    // with changes that aren't ready, sending shows what they need, so it's blocked only with nothing to send
    const blocked = !state.changes.length || general.length > 0 || size?.level === 'error' || (spec.isNew === true && !touched(proposal))
    submit.disabled = blocked
    part('copies').hidden = !touched(proposal)
    // over the length a link can carry, sending copies the changeset and opens the blank form, in one action (D56, D89)
    const tooLong = count > 0 && issueLink(spec, state.ready).tooLong
    part('paste-note').hidden = !tooLong
    submit.textContent = tooLong ? 'Copy the changeset and open the issue' : 'Open the GitHub issue'
  }

  // the draft link for the form as it is now, made as the form changes so a click can copy it at once,
  // as some browsers only allow copying straight after the click (D87)
  let draftLink: Promise<string> = Promise.resolve('')
  function makeDraftLink (proposal: Proposal) {
    const url = new URL(location.pathname, location.href)
    // a new system's link says its place, as the page needs it, and the draft says it too (D91)
    if (spec.isNew) url.searchParams.set('place', spec.place!)
    draftLink = encodeDraft(spec, proposal).then(text => `${url.href}#draft=${text}`)
  }

  /** The mode as the form shows it: `data-recheck`, and the control, which is in step with it. It doesn't read the form again. */
  function showMode (on: boolean) {
    form.toggleAttribute('data-recheck', on)
    for (const radio of all(form, 'input[name="mode"]')) radio.checked = (radio.value === 'recheck') === on
  }

  /** The address as the mode has it, `?recheck` or not, without a new page or history entry, keeping the rest of it and a draft's hash */
  function showModeInAddress (on: boolean) {
    try {
      history.replaceState(history.state, '', location.pathname + searchWithRecheck(location.search, on) + location.hash)
    } catch { /* an address that can't be changed, like a preview's, only loses the link */ }
  }

  /** Switch the mode: the form, the address and the rows' controls. Rows and their confirmations are as they were. */
  function setMode (on: boolean) {
    showMode(on)
    showModeInAddress(on)
    update()
  }

  function update () {
    const proposal = read()
    problems = checkProposal(spec, proposal, today)
    const state = readiness(spec, proposal, today)
    showProblems()
    showReceipt(proposal, state)
    makeDraftLink(proposal)
    // a new edit after a fallback, a link to copy or a word about unready changes hides it, as it's out of
    // date, and the draft button says what it does again
    part('fallback').hidden = true
    hideCopyText()
    part('confirm').hidden = true
    return { proposal, problems, state }
  }

  // A reason stops at MAX_REASON characters, as a person counts them (D89). maxlength counts UTF-16
  // units, which would stop Arabic or emoji early, so the script does it: what's typed or pasted over the
  // limit is cut to fit where it goes, and the counter says so for a paste. A change that gets past, like
  // an input method's, is cut at the end, the caret staying where it was.
  let cut = false

  /** The reason's counter, at the right of its line: nothing until it's near the limit, then, quietly, how much is left */
  function countReason (textarea: HTMLTextAreaElement) {
    const counter = textarea.closest('[data-evidence]')?.querySelector<HTMLElement>('[data-count]')
    if (!counter) return
    const n = graphemeCount(textarea.value)
    counter.textContent = cut ? `Cut to ${MAX_REASON} characters` : n > MAX_REASON ? `${n - MAX_REASON} over` : n >= MAX_REASON - 100 ? `${MAX_REASON - n} left` : ''
    cut = false
  }

  /** Cut a reason to MAX_REASON characters, if it's over */
  function cutReason (textarea: HTMLTextAreaElement) {
    if (graphemeCount(textarea.value) <= MAX_REASON) return
    const caret = textarea.selectionEnd
    textarea.value = firstGraphemes(textarea.value, MAX_REASON)
    const at = Math.min(caret, textarea.value.length)
    textarea.setSelectionRange(at, at)
    cut = true
  }

  const isReason = (target: EventTarget | null): target is HTMLTextAreaElement => target instanceof HTMLTextAreaElement && target.matches('[data-reason]')

  form.addEventListener('beforeinput', event => {
    const textarea = event.target
    if (!isReason(textarea) || event.isComposing) return
    const data = /^insert(LineBreak|Paragraph)$/.test(event.inputType) ? '\n'
      : event.inputType.startsWith('insert') ? event.data ?? event.dataTransfer?.getData('text/plain') ?? null : null
    if (data === null) return
    const { value, selectionStart: start, selectionEnd: end } = textarea
    if (graphemeCount(value.slice(0, start) + data + value.slice(end)) <= MAX_REASON) return
    event.preventDefault()
    // what fits of it, where it goes
    const fits = firstGraphemes(data, MAX_REASON - graphemeCount(value.slice(0, start) + value.slice(end)))
    if (fits) textarea.setRangeText(fits, start, end, 'end')
    // a key pressed at the limit just does nothing; a paste that's cut says so
    cut = graphemeCount(data) > 1
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })

  /**
   * Text was typed, deleted or pasted in a text row's box (D95): a value turns Not Found off, and the text it was kept as is no longer
   * wanted; an empty box on a row whose value is Not Found turns it on again, which is the row as it was loaded
   */
  function typed (box: HTMLInputElement) {
    const notFound = box.closest<HTMLElement>('[data-field]')?.querySelector<HTMLInputElement>('input[data-not-found]')
    const field = spec.fields.find(field => field.id === box.closest<HTMLElement>('[data-field]')?.dataset.field)
    if (!notFound || !field) return
    const on = notFoundAfterTyping({ current: field.current, text: box.value, on: notFound.checked })
    if (on === notFound.checked) return
    notFound.checked = on
    if (!on) delete box.dataset.kept
  }

  form.addEventListener('input', event => {
    const target = event.target
    // a "Still true" box is read on its `change`, which comes after this: reading the form now would put the box back
    if (target instanceof HTMLInputElement && target.dataset.confirm !== undefined) return
    if (isReason(target)) {
      const input = event as InputEvent
      if (!input.isComposing && !input.inputType?.startsWith('delete')) cutReason(target)
      countReason(target)
    }
    if (target instanceof HTMLInputElement && target.type === 'text' && target.name.startsWith('v-')) typed(target)
    update()
  })

  form.addEventListener('compositionend', event => {
    if (!isReason(event.target)) return
    cutReason(event.target)
    countReason(event.target)
    update()
  })

  // an input's error shows when the person leaves it (D89)
  form.addEventListener('focusout', event => {
    const input = event.target as Element
    const field = input.closest<HTMLElement>('[data-field]')?.dataset.field
    const about = aboutOf(input)
    if (!field || !about) return
    reveal(field, about)
    showProblems()
  })

  form.addEventListener('change', event => {
    const input = event.target as HTMLInputElement
    const el = input.closest<HTMLElement>('[data-field]')
    // Edit | Recheck (D94)
    if (input.name === 'mode') {
      setMode(input.value === 'recheck')
      return
    }
    // "Still true" (D92): ticked, the value stays and its evidence opens; unticked, the confirmation is cancelled, as Undo does
    if (el && input.dataset.confirm !== undefined) {
      el.toggleAttribute('data-confirmed', input.checked)
      update()
      if (input.checked) el.querySelector<HTMLTextAreaElement>('textarea[data-reason]')?.focus({ preventScroll: true })
      // outside recheck mode an unconfirmed row has no checkbox, so focus goes to its value rather than nowhere
      else if (el.dataset.slot === 'none') el.querySelector<HTMLElement>(inputFor.value)?.focus({ preventScroll: true })
      return
    }
    // Not Found stands alone in a multi-valued field
    if (el && input.type === 'checkbox' && input.checked && input.name.startsWith('v-')) {
      for (const other of all(el, `input[name="${CSS.escape(input.name)}"]`)) {
        if (other !== input && (input.dataset.alone !== undefined || other.dataset.alone !== undefined)) other.checked = false
      }
    }
    // and clears a text box, which gets its text back if it's unticked. The box is never disabled, and typing in it turns Not Found off (D95)
    if (el && input.dataset.notFound !== undefined) {
      const box = el.querySelector<HTMLInputElement>('input[type=text][name^="v-"]')!
      if (input.checked) {
        box.dataset.kept = box.value
        box.value = ''
      } else {
        box.value = box.dataset.kept ?? ''
        delete box.dataset.kept
      }
      if (!input.checked) box.focus()
    }
    update()
    // choosing isn't typing: a value chosen shows its error at once. Not Found clicked off is, in effect, the start of typing in the box, which has
    // the focus now, so an empty box shows its error when it's left, as when its text is deleted (D95)
    if (el && (input.type === 'radio' || input.type === 'checkbox') && input.dataset.notFound === undefined) {
      reveal(el.dataset.field!, 'value')
      showProblems()
    }
  })

  form.addEventListener('click', event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[type=button]')
    const el = button?.closest<HTMLElement>('[data-field]')
    if (!button || !el) return
    if (button.dataset.undo !== undefined) {
      // back to the value the page started with
      for (const input of all(el, 'input[name^="v-"], input[data-not-found]')) {
        input.checked = input.defaultChecked
        input.value = input.defaultValue
      }
      delete el.querySelector<HTMLInputElement>('input[type=text][name^="v-"]')?.dataset.kept
      el.removeAttribute('data-confirmed')
      update()
    }
    if (button.dataset.addSource !== undefined) addSource(el).focus()
  })

  /** Scroll to a row and focus its input for `about`, or its value */
  function focusRow (field: string, about: Problem['about'] = 'value') {
    const el = row(field)
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    // the first of the selectors that matches, so a choice's ticked value before its first
    const input = inputFor[about].split(', ').map(selector => el.querySelector<HTMLElement>(selector)).find(Boolean) ?? el.querySelector<HTMLElement>('input, textarea')
    input?.focus({ preventScroll: true })
  }

  /**
   * Open the issue's link for the ready changes. If the link is too long, it's one action: the changeset is
   * copied, and the blank form opened to paste it into; if the browser won't copy, the changeset is shown,
   * selected, to copy by hand (D56, D89).
   */
  async function send (state: Readiness) {
    const link = issueLink(spec, state.ready)
    if (link.tooLong) {
      // copying starts first, while the click still counts as the person's
      const copied = clipboard(link.toml)
      openTab(link.blank)
      sent = true
      if (await copied) return flash(submit, 'Copied, and the issue opened')
      part<HTMLTextAreaElement>('fallback-toml').value = link.toml
      part<HTMLAnchorElement>('fallback-link').href = link.blank
      part('fallback').hidden = false
      part<HTMLTextAreaElement>('fallback-toml').select()
      part('fallback').scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      return
    }
    openTab(link.url)
    sent = true
  }

  /**
   * Send the ready changes. If some changes aren't ready, their rows show what they need, and a word
   * in the page says they won't be sent, with a button to send the ready ones anyway or keep editing.
   */
  function trySend () {
    const { state } = update()
    // every row's errors show now (D89)
    for (const problem of problems) if (problem.level === 'error' && problem.field) reveal(problem.field, problem.about ?? 'value')
    showProblems()
    // something about the whole proposal to fix first, as the panel says
    if (submit.disabled) return
    if (state.changes.every(change => !change.needs.length)) return send(state)
    // nothing ready: to the first thing a change needs
    if (!state.ready.edits.length && !state.ready.remove) return focusFirst()
    part('confirm-text').textContent = notReadyText(state)
    part('confirm-send').textContent = sendReadyText(state)
    part('confirm').hidden = false
    part('confirm').scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    part('confirm').focus({ preventScroll: true })
  }

  form.addEventListener('submit', event => {
    event.preventDefault()
    trySend()
  })

  part('confirm-send').addEventListener('click', () => {
    const { state } = update()
    send(state)
  })

  /** Back to the first change that isn't ready, at the first thing it needs */
  function focusFirst () {
    const first = problems.find(problem => problem.level === 'error' && problem.field)
    // a new system with no field: the first field's row, not the top section's, which has no value
    if (first?.field === 'create' && first.about === 'value') return focusRow(spec.fields[0].id)
    if (first?.field) focusRow(first.field, first.about)
  }

  part('confirm-keep').addEventListener('click', () => {
    update()
    focusFirst()
  })

  // a change in the receipt goes to its row: the link marks it (:target), and its value takes focus
  part('receipt-body').addEventListener('click', event => {
    const link = (event.target as Element).closest<HTMLElement>('a[data-goto]')
    if (link) setTimeout(() => focusRow(link.dataset.goto!))
  })

  /** Say something on a button for a moment, then its label again */
  function flash (button: HTMLElement, text: string) {
    const label = button.dataset.label ??= button.textContent ?? ''
    button.textContent = text
    setTimeout(() => {
      button.textContent = label
      delete button.dataset.label
    }, 2500)
  }

  /** Copy `text`, and say so on the button. If the browser won't, `box` shows it selected, to copy by hand. */
  async function copy (button: HTMLElement, text: string | Promise<string>, box: HTMLTextAreaElement) {
    const value = typeof text === 'string' ? text : await text
    if (await clipboard(value)) return flash(button, 'Copied')
    box.value = value
    box.hidden = false
    box.select()
    button.dataset.label ??= button.textContent ?? ''
    button.textContent = 'Press Ctrl+C or ⌘C to copy'
  }

  /** The draft link shown to copy by hand, and the button's own label, put away once the form changes */
  function hideCopyText () {
    part('copy-text').hidden = true
    const button = part('copy-draft')
    if (button.dataset.label !== undefined) {
      button.textContent = button.dataset.label
      delete button.dataset.label
    }
  }

  // the draft link: to finish later, to pass on, or to open in a browser that's signed in to GitHub (D87, D90)
  part('copy-draft').addEventListener('click', () => copy(part('copy-draft'), draftLink, part('copy-text')))

  // unsent changes are lost if the page goes, so ask first
  window.addEventListener('beforeunload', event => {
    if (!sent && touched(read())) event.preventDefault()
  })

  // the receipt is always open on desktop, with no disclosure; on a phone, where editing is harder, it starts closed
  const receipt = part<HTMLDetailsElement>('receipt')
  const narrow = matchMedia('(max-width: 900px)')
  const fit = () => {
    receipt.open = !narrow.matches
    receipt.querySelector('summary')!.tabIndex = narrow.matches ? 0 : -1
  }
  fit()
  narrow.addEventListener('change', fit)
  receipt.addEventListener('toggle', () => { if (!narrow.matches && !receipt.open) receipt.open = true })

  // /<id>/edit/?recheck opens the page in recheck mode (D94)
  if (!spec.isNew && form.querySelector('[data-mode]') && recheckInSearch(location.search)) showMode(true)

  // /<id>/edit/?field=<field id> opens that field's row, ready for a new value
  const fieldId = spec.isNew ? null : new URLSearchParams(location.search).get('field')
  const request = document.getElementById('request')!
  if (fieldId) {
    const field = spec.fields.find(field => field.id === fieldId)
    if (field) {
      const el = row(field.id)
      el.toggleAttribute('data-open', true)
      evidenceIn(el)
      el.scrollIntoView({ block: 'center' })
      el.querySelector<HTMLInputElement>('input:not([type=hidden]):not(:disabled)')?.focus({ preventScroll: true })
      request.textContent = `You asked to change one field: ${field.title}. You can change others too.`
    } else {
      request.textContent = `There’s no field “${fieldId}” to change in this system, so here are all its fields.`
    }
    request.hidden = false
  }

  /** A change's evidence into its row's inputs, opening the row */
  function fillEvidence (el: HTMLElement, evidence: { reason: string, sources: string[], as_of: string }) {
    el.toggleAttribute('data-open', true)
    const box = evidenceIn(el)
    const reason = box.querySelector<HTMLTextAreaElement>('textarea[data-reason]')!
    reason.value = evidence.reason
    countReason(reason)
    while (all(box, 'input[data-source]').length < evidence.sources.length) addSource(box)
    all(box, 'input[data-source]').forEach((input, i) => { input.value = evidence.sources[i] ?? '' })
    // without a real date, it stays today
    if (evidence.as_of) box.querySelector<HTMLInputElement>('input[data-as-of]')!.value = evidence.as_of
  }

  /** A draft's proposal into the form: each value, its evidence, and the removal. decodeDraft has checked the form can hold them. */
  function restore ({ create, edits, remove }: { create?: CreateEdit, edits: FieldEdit[], remove?: RemoveEdit }) {
    // a draft with a confirmation opens in recheck mode (D94); one without leaves the mode as the address had it
    if (!spec.isNew && hasConfirmations({ edits }) && form.querySelector('[data-mode]')) {
      showMode(true)
      showModeInAddress(true)
    }
    if (create) fillEvidence(row('create'), create)
    for (const edit of edits) {
      const field = spec.fields.find(field => field.id === edit.field)!
      const el = row(field.id)
      if (field.control === 'choice') {
        for (const input of all(el, 'input[type=radio]')) input.checked = input.value === edit.value
      } else if (field.control === 'multi') {
        const ticked = splitParts(field, edit.value)
        for (const input of all(el, 'input[type=checkbox][name^="v-"]')) input.checked = ticked.includes(input.value)
      } else {
        const notFound = el.querySelector<HTMLInputElement>('input[data-not-found]')
        const box = el.querySelector<HTMLInputElement>('input[type=text][name^="v-"]')!
        const isNotFound = edit.value === NOT_FOUND && notFound !== null
        if (notFound) notFound.checked = isNotFound
        box.value = isNotFound ? '' : edit.value
        delete box.dataset.kept
      }
      if (edit.confirmed) el.toggleAttribute('data-confirmed', true)
      fillEvidence(el, edit)
    }
    if (remove) {
      const el = row('remove')
      el.querySelector<HTMLInputElement>('input[data-remove]')!.checked = true
      el.querySelector<HTMLInputElement>('input[data-replacement]')!.value = remove.duplicate_of ?? ''
      fillEvidence(el, remove)
    }
    row(edits[0]?.field ?? (spec.isNew ? 'create' : 'remove')).scrollIntoView({ block: 'center' })
  }

  // /<id>/edit/#draft=<text>, a draft link, restores the form as it was when the link was made. A
  // draft for another system, or one that can't be read, leaves the form as it is (D87)
  const draft = new URLSearchParams(location.hash.slice(1)).get('draft')
  if (draft !== null) {
    const note = document.getElementById('draft-note')!
    decodeDraft(spec, draft).then(result => {
      if (result.ok) {
        restore(result.proposal)
        note.textContent = 'Restored a draft from the link.' + (result.ignored.length ? ` Some of it doesn’t fit this page, so it was left out: ${result.ignored.join(', ')}.` : '')
      } else note.textContent = result.message
      note.hidden = false
      update()
    })
  }

  update()
}
