// Série d'exemple proposée sur l'écran d'accueil vide (bouton « Ajouter la série d'exemple »).
export const SAMPLE_SET = {
  title: 'Connecteurs logiques',
  folder: 'Anglais',
  termLang: 'fr-FR',
  defLang: 'en-GB',
  cards: [
    ['ainsi (t)', 'thus'],
    ['c\'est un sujet épineux', 'This is a thorny issue'],
    ['ce qui a été démontré par (introduire exemple)', 'as evidenced by,'],
    ['Cela contraste beaucoup avec', 'This contrasts greatly with'],
    ['ces 2 arguments sont vrais jusqu\'à un certain point', 'Both points are true up to a point'],
    ['de plus (ajouter argument)', 'besides, moreover'],
    ['est ce vraiment surprenant que .. ? (question rhétorique)', 'it is really surprising that ... ?'],
    ['il nous incombe de nous demander si', 'It behoves us to ask whether'],
    ['Le problème en jeu ici', 'what is at stake here'],
    ['nous devrions souligner que', 'it should be stressed that'],
    ['On peut raisonnablement soutenir que', 'One can sensibly advocate that'],
    ['plus precisement', 'more specifically'],
    ['Si on peut admettre que', 'While it may be conceded that'],
    ['tout d\'abord', 'to begin with'],
  ].map(([term, definition]) => ({ term, definition })),
};
