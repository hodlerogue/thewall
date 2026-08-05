import { describe, expect, it } from 'vitest'
import { CONTACT, DOCUMENTS, PRIVACY, TERMS, jurisdiction } from '@/lib/legal/documents'

/**
 * A policy is a promise about what the code does, so the things worth testing
 * are the places it could quietly stop being true.
 *
 * These do not check that the prose is good. They check that it is *complete*
 * in the ways that matter legally — a reachable contact, a named processor for
 * every third party the code actually talks to, a stated retention period, and
 * a deletion route — because a policy missing any of those is worse than none:
 * it is a published claim that is false.
 */

describe('both documents', () => {
  it('are reachable, titled, and made of real sections', () => {
    for (const doc of DOCUMENTS) {
      expect(doc.title, doc.path).toBeTruthy()
      expect(doc.path, doc.title).toMatch(/^\/[a-z]+$/)
      expect(doc.sections.length, doc.title).toBeGreaterThan(4)

      for (const section of doc.sections) {
        expect(section.heading, doc.title).toBeTruthy()
        expect(section.body.length, `${doc.title} / ${section.heading}`).toBeGreaterThan(0)
        for (const paragraph of section.body) {
          expect(paragraph.trim(), `${doc.title} / ${section.heading}`).not.toBe('')
        }
      }
    }
  })

  it('publish one contact address, and it is the same one', () => {
    expect(CONTACT).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)
    for (const doc of DOCUMENTS) {
      const full = doc.sections.flatMap((s) => s.body).join('\n')
      expect(full, doc.title).toContain(CONTACT)
    }
  })

  it('say where to read the whole thing, since the shell only prints a summary', () => {
    for (const doc of DOCUMENTS) {
      expect(doc.summary.join('\n'), doc.title).toContain(`thewall.social${doc.path}`)
      // Short enough that somebody actually reads it in a scrollback.
      expect(doc.summary.length, doc.title).toBeLessThanOrEqual(10)
    }
  })
})

describe('the privacy policy', () => {
  const full = PRIVACY.sections.flatMap((s) => s.body).join('\n').toLowerCase()

  it('names every third party the code actually sends data to', () => {
    // If a processor is added to the stack and not added here, the policy
    // becomes a false statement rather than an incomplete one.
    for (const processor of ['supabase', 'netlify', 'resend']) {
      expect(full, processor).toContain(processor)
    }
  })

  it('accounts for everything the schema stores about a person', () => {
    // Every one of these is a column somebody could be identified by. The list
    // grows when the schema does — `created_by` arrived with user-made rooms
    // and was personal data nobody had written down.
    for (const held of ['name', 'email', 'post', 'ip address', 'rooms you opened']) {
      expect(full, held).toContain(held)
    }
  })

  it('does not claim who made a room is public, because it is not', () => {
    // The interface never shows it and the grant does not expose it — the
    // policy has to match, or it is describing a different site.
    expect(full).toMatch(/not public.*(site never shows who made a room|who made a room)/i)
  })

  it('says what happens to a room when the person who made it leaves', () => {
    // The awkward case, and the one somebody exercising erasure will ask
    // about: their account goes and the room does not.
    expect(full).toContain('outlives your account')
  })

  it('states a lawful basis, which is the part a template usually invents', () => {
    expect(full).toMatch(/legitimate interest/)
    expect(full).toMatch(/contract/)
  })

  it('states how long things are kept, including the two the database enforces', () => {
    // 24 hours is the commons select policy; one hour is the signup rate-limit
    // window. Both are real numbers in the migrations, not aspirations.
    expect(full).toContain('24 hours')
    expect(full).toContain('one hour')
  })

  it('offers the rights that have to be offered, and a way to use them', () => {
    for (const right of ['access', 'correction', 'deletion', 'portability', 'object']) {
      expect(full, right).toContain(right)
    }
    expect(full).toContain('30 days')
  })

  it('does not claim renaming is private in a way the product is not', () => {
    // Names *are* published; previous names are not. The policy has to draw
    // that line the same way the code does.
    expect(full).toMatch(/previously used|previously somebody/)
  })
})

describe('the terms', () => {
  const full = TERMS.sections.flatMap((s) => s.body).join('\n').toLowerCase()

  it('say what happens when somebody breaks them, and how to ask why', () => {
    expect(full).toMatch(/hidden|stopped from posting/)
    expect(full).toContain(CONTACT.toLowerCase())
  })

  it('keep the copyright with the person who wrote the words', () => {
    expect(full).toContain('copyright')
    expect(full).toMatch(/you keep/)
  })

  it('describe making a room as it is actually built', () => {
    const terms = full
    expect(terms).toContain('three in any seven days')
    expect(terms).toContain('verified')
    // The claim the product makes structurally, so the terms must make it too.
    expect(terms).toMatch(/does not make it yours|no owner/)
    // Fading is not deletion, and somebody whose room left the lobby will want
    // to know which one happened.
    expect(terms).toContain('not deleted')
  })

  it('list every lever that can be used against somebody', () => {
    for (const lever of ['hidden', 'closed', 'stopped from posting']) {
      expect(full, lever).toContain(lever)
    }
  })

  it('describe the rename rule as it is actually built', () => {
    // Free recycling is a decision with a consequence, and terms that skipped
    // it would be describing a different product.
    expect(full).toMatch(/available to anyone|free for anyone/)
    expect(full).toMatch(/changed hands/)
  })

  it('disclaim what a side project has to disclaim', () => {
    expect(full).toMatch(/no warranty|as it is/)
    expect(full).toMatch(/shut down/)
  })

  it('never name a governing law that has not been chosen', () => {
    // The clause is about where the operator is, and guessing puts a false
    // statement on a published page. So it either names the real place or it
    // says outright that it does not know — never a plausible-looking default.
    const law = TERMS.sections.find((s) => s.heading === 'Law')!
    const text = law.body.join('\n')

    const where = jurisdiction()
    if (where === null) {
      expect(text).toContain('NOT SET YET')
      // And it has to be visible from the outside, not just in the source.
      expect(TERMS.summary.join('\n')).toContain('governing law')
    } else {
      expect(text).toContain(where.law)
      expect(text).toContain(where.courts)
      expect(text).not.toContain('NOT SET YET')
      expect(TERMS.summary.join('\n')).not.toContain('governing law')
    }
  })

  it('keep a visitor’s own consumer rights whatever law governs', () => {
    // Someone in the UK using a site run from elsewhere does not get UK law
    // over the terms — they get this, which is the thing that actually
    // protects them, plus the GDPR sections of the privacy policy.
    const text = TERMS.sections.find((s) => s.heading === 'Law')!.body.join('\n')
    expect(text).toMatch(/cannot be signed away/)
    expect(text).toMatch(/UK/)
    expect(text).toMatch(/EU/)
    expect(text).toMatch(/local courts/)
  })
})
