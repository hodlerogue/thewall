-- Commons says what it is for: general talk, any topic.
--
-- Its description was "everything, briefly", which `look` now prints as
-- "commons is for: everything, briefly" — accurate about the 24 hours, and no
-- help to somebody wondering what belongs there. Changed by the owner.
--
-- Commons came with the building, so `describe` cannot change it (only whoever
-- made a room can, and nobody made this one). Hence a migration. Matched on the
-- old wording as well as the slug, so running it after somebody has changed
-- the description by hand some other way leaves theirs alone.

update public.rooms
   set gloss = 'general talk, any topic'
 where slug = 'commons'
   and gloss = 'everything, briefly';
