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
