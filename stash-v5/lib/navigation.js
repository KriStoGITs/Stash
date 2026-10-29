export const roleLabels = {
  admin: 'Administrators',
  worker: 'Noliktavas darbinieks',
  sorter: 'Plauktu kārtotājs',
};
export const navigationLinks = [
  ['/', '⌂', 'Sākums', ['admin', 'worker', 'sorter']],
  ['/products', '▤', 'Preces', ['admin', 'worker', 'sorter']],
  ['/products/new', '+', 'Pievienot produktu', ['admin']],
  ['/users/new', '+', 'Pievienot lietotāju', ['admin']],
  ['/users', '♙', 'Lietotāji', ['admin']],
  ['/orders', '♧', 'Veikt pasūtījumu', ['worker']],
  ['/placement', '▦', 'Izvietot preces', ['sorter']],
  ['/placement/data', '♙', 'Datu ievade', ['sorter']],
];
