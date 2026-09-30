```sigil
component SearchService {
  goal {
    Find records matching supplied text.
  }
  interface {
    Accept a *query* and return *search results* as matching records.
  }
}
```
````sigil
@search/service.sigil from SearchService import { query, search results }

component SearchPanel {
  goal {
    Help the user find records with query.
  }

  constraints {
    Only the active request may publish search results.
  }

  interface {
    Display search results for the active request while preserving visible records until the replacement request completes and supplies its own matching records.

    Follow the [display policy](../policy.md).

    Example payload stays exact.
    ```text
    literal  spacing and *not a Tag*
    ```
  }
}
````
