/* Server messages are written in Hebrew (the default UI language). When the
   client sends `X-PocKeep-Lang: en`, the error handler translates them here. */

const EXACT = {
  'לא נמצא': 'Not found',
  'יש להתחבר': 'Please sign in',
  'יש להתחבר מחדש': 'Please sign in again',
  'יש להחליף את הסיסמה לפני שממשיכים': 'Change your password before continuing',
  'הבקשה נחסמה (חסרה כותרת אבטחה)': 'Request blocked (missing security header)',
  'משהו השתבש בשרת. כדאי לבדוק את הלוגים של הקונטיינר.': 'Something went wrong on the server. Check the container logs.',
  'הקובץ גדול מדי עבור השרת. אפשר להגדיל את MAX_IMPORT_MB או MAX_BACKUP_MB.': 'The file is too large for this server. Raise MAX_IMPORT_MB or MAX_BACKUP_MB.',
  'סוג הקובץ לא נתמך': 'This file type is not supported',
  'הבקשה לא תקינה': 'Invalid request',
  'יותר מדי ניסיונות התחברות. אפשר לנסות שוב בעוד 15 דקות.': 'Too many sign-in attempts. Try again in 15 minutes.',
  'שם המשתמש או הסיסמה שגויים': 'Wrong username or password',
  'ההרשמה סגורה. מנהל המערכת יוצר את החשבונות.': 'Registration is closed. The admin creates accounts.',
  'יותר מדי ניסיונות. אפשר לנסות שוב בעוד 15 דקות.': 'Too many attempts. Try again in 15 minutes.',
  'רק מנהל מערכת יכול לנהל משתמשים': 'Only an admin can manage users',
  'מזהה משתמש לא תקין': 'Invalid user id',
  'המשתמש לא נמצא': 'User not found',
  'שם משתמש צריך להכיל 3–32 תווים באנגלית: אותיות, ספרות, נקודה, מקף או קו תחתון': 'Usernames are 3–32 characters: Latin letters, digits, dot, dash or underscore',
  'הסיסמה ארוכה מדי': 'That password is too long',
  'שם המשתמש הזה כבר תפוס': 'That username is taken',
  'תפקיד לא מוכר': 'Unknown role',
  'חייב להישאר לפחות מנהל אחד במערכת': 'There must be at least one admin',
  'אי אפשר להסיר את הרשאות הניהול מעצמך': "You can't remove your own admin role",
  'אי אפשר למחוק את החשבון שאיתו התחברת': "You can't delete the account you're signed in with",
  'הסיסמה הנוכחית שגויה': 'Your current password is wrong',
  'הסיסמה החדשה צריכה להיות שונה מהנוכחית': 'The new password must be different from the current one',
  'הכרטיס לא נמצא': 'Card not found',
  'לא נשלחו שינויים': 'No changes were sent',
  'יותר מדי שינויים בבקשה אחת': 'Too many changes in one request',
  'פעולה לא מוכרת': 'Unknown action',
  'הכרטיס המקורי כבר לא קיים': 'The original card no longer exists',
  'רשימת הקטגוריות ריקה': 'The category list is empty',
  'יותר מדי קטגוריות': 'Too many categories',
  'לכל קטגוריה צריך להיות שם': 'Every category needs a name',
  'מזהה קטגוריה כפול': 'Duplicate category id',
  'אי אפשר למחוק את הקטגוריה „לא ממוינים”': 'The “Unsorted” category cannot be removed',
  'סוג התנאי לא מוכר': 'Unknown rule condition',
  'יש להזין טקסט לחיפוש (עד 300 תווים)': 'Enter a pattern (up to 300 characters)',
  'הביטוי הרגולרי לא תקין': 'That regular expression is not valid',
  'הקטגוריה לא קיימת': 'Unknown category',
  'לכלל צריך להיות יעד: קטגוריה או לפחות תווית אחת': 'A rule needs a category or at least one label',
  'הכלל לא נמצא': 'Rule not found',
  'יש להזין שם לתווית': 'Enter a label name',
  'הקובץ הזה אינו גיבוי של פוקיפ': 'This file is not a PocKeep backup',
  'תוויות חייבות להיות רשימה': 'Labels must be a list',
  'חסר שם תווית': 'Label name is missing',
  'הקובץ ריק': 'The file is empty',
  'התצוגה המקדימה פגה. יש לבחור את הקובץ שוב.': 'This preview expired. Choose the file again.',
  'מצב שחזור לא מוכר': 'Unknown restore mode',
  'השינוי לא תקין': 'Invalid change',
  'סוג כרטיס לא מוכר': 'Unknown card type',
  'צבע לא מוכר': 'Unknown color',
  'סטטוס לא מוכר': 'Unknown status',
  'הסימונים לא תקינים': 'Invalid flags',
  'השדות לא תקינים': 'Invalid fields',
  'הכרטיס הזה נמחק לצמיתות': 'This card was permanently deleted',
  'הכרטיס נעול. יש לבטל את הנעילה קודם.': 'This card is locked. Unlock it first.',
  'הקובץ לא זוהה. יש להעלות ייצוא צ׳אט של וואטסאפ (‎.txt‎) או קובץ ‎.md‎ מומר.': 'Unrecognized file. Upload a WhatsApp chat export (.txt) or a converted .md file.'
};

const PATTERNS = [
  [/^הסיסמה צריכה להכיל לפחות (\d+) תווים$/, m => `Passwords need at least ${m[1]} characters`],
  [/^השדה (\S+) חייב להיות טקסט$/, m => `${m[1]} must be text`],
  [/^השדה (\S+) ארוך מדי \(עד (\d+) תווים\)$/, m => `${m[1]} is too long (max ${m[2]} characters)`],
  [/^אפשר עד (\d+) תוויות כאן$/, m => `At most ${m[1]} labels are allowed here`],
  [/^הערך של (\S+) לא תקין$/, m => `Invalid value for ${m[1]}`],
  [/^השדה (\S+) לא תקין$/, m => `Invalid field ${m[1]}`],
  [/^השדה (\S+) גדול מדי$/, m => `Field ${m[1]} is too large`],
  [/^הבקשה נכשלה \((\d+)\)$/, m => `Request failed (${m[1]})`]
];

export const requestLang = req => (String(req.headers['x-pockeep-lang'] || '').toLowerCase().startsWith('en') ? 'en' : 'he');

export function translate(message, lang) {
  if (lang !== 'en' || typeof message !== 'string') return message;
  if (EXACT[message]) return EXACT[message];
  for (const [re, fn] of PATTERNS) { const m = message.match(re); if (m) return fn(m); }
  return message;
}
