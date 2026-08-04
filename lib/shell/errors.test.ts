import { describe, expect, it } from 'vitest'
import { describeError } from '@/lib/shell/errors'

const text = (error: unknown) =>
  describeError(error)
    .map((l) => l.text)
    .join('\n')

describe('nothing ever renders as [object Object]', () => {
  // The exact shapes Supabase throws. None of these is an Error instance,
  // which is how the original `String(error)` produced "[object Object]".
  const supabaseShapes: [string, unknown][] = [
    [
      'PostgrestError — missing table',
      {
        message: "Could not find the table 'public.room_overview' in the schema cache",
        details: null,
        hint: null,
        code: 'PGRST205',
      },
    ],
    [
      'PostgrestError — permission denied',
      { message: 'permission denied for table posts', details: null, hint: null, code: '42501' },
    ],
    ['AuthApiError shape', { message: 'Invalid API key', status: 401 }],
    ['GoTrue error_description', { error: 'invalid_grant', error_description: 'Email not confirmed' }],
    ['an object with nothing useful', { status: 500 }],
    ['an empty object', {}],
  ]

  for (const [name, error] of supabaseShapes) {
    it(`handles ${name}`, () => {
      const out = text(error)
      expect(out).not.toContain('[object Object]')
      expect(out.trim().length).toBeGreaterThan(0)
    })
  }

  it('handles the primitives too', () => {
    for (const error of [new Error('a real error'), 'a string', null, undefined, 42]) {
      const out = text(error)
      expect(out).not.toContain('[object Object]')
      expect(out.trim().length).toBeGreaterThan(0)
    }
  })

  it('keeps the message when there is one', () => {
    expect(text({ message: 'permission denied for table posts', code: '42501' })).toContain(
      'permission denied for table posts',
    )
    expect(text(new Error('a real error'))).toContain('a real error')
  })

  it('falls back to the serialised object rather than a useless string', () => {
    // Better to show a person raw JSON than to tell them nothing at all.
    expect(text({ status: 500, path: '/rest/v1/rooms' })).toContain('500')
  })
})

describe('the failures worth naming get named (§3.7)', () => {
  it('points a missing table at the deploy script', () => {
    const out = text({
      message: "Could not find the table 'public.room_overview' in the schema cache",
      code: 'PGRST205',
    })
    expect(out).toContain('scripts/db-deploy.sh')
  })

  it('recognises the raw postgres code for a missing table too', () => {
    expect(text({ message: 'relation "public.rooms" does not exist', code: '42P01' })).toContain(
      'scripts/db-deploy.sh',
    )
  })

  it('points a permission failure at the grants', () => {
    expect(text({ message: 'permission denied for table posts', code: '42501' })).toContain('grants')
  })

  it('reminds you that a bad anon key needs a rebuild, not just a change', () => {
    const out = text({ message: 'Invalid API key', status: 401 })
    expect(out).toContain('NEXT_PUBLIC_SUPABASE_ANON_KEY')
    expect(out).toContain('redeploy')
  })

  it('separates unreachable from unauthorised', () => {
    expect(text(new TypeError('Failed to fetch'))).toContain('NEXT_PUBLIC_SUPABASE_URL')
  })

  it('shows the hint when it has no better advice of its own', () => {
    const out = text({ message: 'something odd', hint: 'try turning it off and on again' })
    expect(out).toContain('try turning it off and on again')
  })

  it('never says invalid syntax or an error code on its own line', () => {
    for (const [, error] of [['x', { message: 'permission denied', code: '42501' }]] as const) {
      expect(text(error).toLowerCase()).not.toMatch(/^42501$/m)
    }
  })
})

describe('a migration that never landed', () => {
  it('names the fix when a function is missing, not just the table case', () => {
    // PGRST202 is what PostgREST answers for a function that is not there,
    // which means one migration was applied and a later one was not. It used
    // to fall through to the raw message, which is how a missing
    // mark_verified() presented as a magic link that simply did not work.
    const lines = describeError({
      code: 'PGRST202',
      message: 'Could not find the function public.mark_verified without parameters',
    })
    const text = lines.map((line) => line.text).join('\n')
    expect(text).toMatch(/db-deploy/)
    expect(text).toMatch(/missing a database update/)
  })

  it('still tells the table case apart from it', () => {
    const table = describeError({ code: 'PGRST205', message: 'Could not find the table' })
    expect(table.map((l) => l.text).join('\n')).toMatch(/schema hasn’t been applied/)
  })
})
