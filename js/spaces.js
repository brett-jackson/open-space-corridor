// Every open space on the site. `id` is its folder under spaces/ (image, trends_cache.js)
// and its page URL: space.html?id=<id>. `place_id` is the iNaturalist place;
// `location` is its [lat, lng], where its marker sits on the landing page map.
// Instead of `place_id`, a space can give `bbox`: two opposite corners, [[lat, lng], [lat, lng]],
// and either kind can list `exclude`: boxes in the same format whose observations are ignored.
window.SPACES = [
  {
    "id": "broomfield",
    "title": "Broomfield Commons Open Space",
    "subtitle": "Broomfield, Colorado",
    "place_id": 150836,
    "description": "Keeping the Field in Broomfield",
    "image": "spaces/broomfield/broomfield-county-commons-park-broomfield-co.jpg",
    "location": [
      39.932,
      -105.0429
    ]
  },
  {
    "id": "metzger",
    "title": "Metzger Farm Open Space",
    "subtitle": "Westminster, Colorado",
    "place_id": 141434,
    "description": "Metzger Farm, Est. 1943",
    "image": "spaces/metzger/metzger-image.jpeg",
    "location": [
      39.9178,
      -105.0284
    ]
  },
  {
    "id": "plaster-reservoir",
    "title": "Plaster Reservoir Open Space",
    "subtitle": "Broomfield, Colorado",
    "place_id": 141433,
    "description": "Plaster Reservoir",
    "image": "spaces/plaster-reservoir/plaster-reservoir-image.jpeg",
    "location": [
      39.947,
      -105.0251
    ]
  },
  {
    "id": "markel",
    "title": "Markel Open Space",
    "subtitle": "Broomfield, Colorado",
    "place_id": 241801,
    "description": "",
    "image": "spaces/markel/markel.jpg",
    "location": [
      39.9452,
      -105.06
    ]
  },
  {
    "id": "wottge",
    "title": "Wottge Open Space",
    "subtitle": "Broomfield, Colorado",
    "place_id": 241806,
    "description": "",
    "image": "spaces/wottge/wottge.jpg",
    "location": [
      39.9538,
      -105.0554
    ]
  },
  {
    "id": "the-field",
    "title": "The Field Open Space",
    "subtitle": "Broomfield, Colorado",
    "bbox": [
      [
        39.92883528272712,
        -105.0624834592788
      ],
      [
        39.9217231629372,
        -105.07171042577862
      ]
    ],
    "exclude": [
      [
        [
          39.92378866149953,
          -105.07077148513481
        ],
        [
          39.9217560756465,
          -105.07162459509014
        ]
      ]
    ],
    "description": "",
    "image": "spaces/the-field/the-field.jpeg",
    "location": [
      39.9253,
      -105.0671
    ]
  },
  {
    "id": "mckay-lake",
    "title": "McKay Lake Open Space",
    "subtitle": "Westminster, Colorado",
    "place_id": 150834,
    "description": "",
    "image": "spaces/mckay-lake/mckay-lake.jpeg",
    "location": [
      39.953,
      -105.0128
    ]
  }
];
