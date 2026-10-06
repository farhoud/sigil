```sigil
component SearchService {
  goal {
    Find records matching supplied text.
  }
  interface {
    Accept a *query* as search text and return *search results* as matching records.
  }
}
```
```sigil
@search/service.sigil from SearchService import { query, search results }

component SearchPanel {
  goal {
    Help the user find records with query.
  }

  constraints {
    Only the active request may publish search results.
  }

  interface {
    Display search results for the current search.
  }
}
```
```sigil
component SearchPanel {
  goal {
    Show the user's current search results.
  }

  constraints {
    Only the active request may publish results.
    Cancelling a request immediately makes it inactive.
  }

  cases {
    A cancelled request completes after its replacement starts;
    the cancelled request may publish its results.
  }

  interface {
    Publish matching records for the active request.
  }
}
```
```sigil
component AccountService {
  goal {
    Own account-status changes.
  }

  constraints {
    AccountService is the sole final authority for the stored account status.
  }

  interface {
    Set the account's status in the shared account-status store.
  }
}

component AccountConsole {
  goal {
    Let operators manage account status.
  }

  constraints {
    AccountConsole is the sole final authority for the stored account status.
  }

  interface {
    Set the same account's status in the shared account-status store.
  }
}
```
```sigil
component SearchPanel {
  goal {
    Show the user's current search results.
  }

  constraints {
    Only the active request may publish new results.
    An inactive request must never publish new results.
    A response from a request that is no longer active cannot publish new results.
  }

  interface {
    Display matching records.
    Starting a new request preserves the already displayed results until its replacement is ready.
  }
}
```
```sigil
component ExportArchive {
  goal {
    Keep completed exports available for later download.
  }

  constraints {
    Delete expired exports according to the adopted [retention policy](../policy/retention.md).
  }

  interface {
    Let an authorized user download a retained export.
  }
}
```
