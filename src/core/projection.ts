/**
 * The attributes of each custom field entry. YouTrack has no "all attributes" wildcard, so this lists every attribute
 * that carries a value across custom field types. User emails are left out on purpose: the request runs with the
 * technical user's rights. Callers can't change it, so nothing can lead from a field to other entities.
 */
export const FULL_PROJECTION = [
  '$type',
  'id',
  'name',
  'projectCustomField($type,id,field($type,id,name,fieldType(id)))',
  'value($type,id,name,localizedName,login,fullName,text,markdownText,presentation,minutes,isResolved,archived,released,releaseDate,color(id,background,foreground))',
].join(',');

/** The issue attributes get_issue returns next to the custom fields: ones every reader of the issue sees anyway. */
export const ISSUE_PROJECTION =
  'idReadable,summary,description,created,updated,resolved,reporter($type,login,fullName),project($type,shortName,name)';

/**
 * The default, compact entry: each field's name and the one attribute that identifies its value (the text of a text
 * field, the name of an enum, state or version, a user's login, a period's presentation). Simple values like strings,
 * numbers and dates come back as they are. YouTrack adds `$type` to every object.
 */
export const COMPACT_PROJECTION = 'name,value(name,login,text,presentation)';

/** The issue attributes of the compact get_issue, with only the reporter's login and the project's key. */
export const COMPACT_ISSUE_PROJECTION =
  'idReadable,summary,description,created,updated,resolved,reporter(login),project(shortName)';
