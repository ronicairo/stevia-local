const checkDateGreaterOrEqualNow = idInput => {
    const inputDate = document.getElementById(idInput);
    // si l'ibput n'existe on s'arrete
    if (!inputDate) return;

    const errorMessage = document.querySelector(`#${idInput} + .error-message`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // vérification de la date renseignée
    const isDateInvalid = (dateValue) => today >= new Date(dateValue);

    // afficher les errors
    const showError = () => {
        if (errorMessage) {
            errorMessage.textContent = 'Vous devez renseigner une date de report supérieure ou égale à la date du jour';
        }
        inputDate.classList.add('is-invalid');
    };

    // cacher le message
    const clearError = () => {
        if (errorMessage) {
            errorMessage.textContent = '';
        }
        inputDate.classList.remove('is-invalid');
        inputDate.classList.add('is-valid');
    };

    const handleChange = () => {
        const dateValue = inputDate.value;
        if (isDateInvalid(dateValue)) {
            showError();
        } else {
            clearError();
        }
    };

    const handleSubmit = (e) => {
        const dateValue = inputDate.value;
        if (isDateInvalid(dateValue)) {
            showError();
            e.preventDefault();
        }
    };

    inputDate.addEventListener('change', handleChange);

    const submitButton = document.querySelector(`button[type="submit"]`);
    if (submitButton) {
        submitButton.addEventListener('click', handleSubmit);
    }
};

const checkInputRequired = () => {
    const btnSubmit = document.querySelectorAll('button[type="submit"]');
    const inputRequired = document.querySelectorAll('input[required="required"], textarea[required="required"], select[required="required"]');

    if (!btnSubmit) return;

    // montrer le message d'erreur
    const showErrorMessage = (input, message) => {
        const elementMessage = input.closest('.input-container').querySelector('.error-message')
        if (elementMessage) {
            elementMessage.textContent = message;
            elementMessage.classList.remove('d-none')
        }
        input.classList.add('is-invalid');
    };

    // cacher le message d'erreur'
    const clearErrorMessage = (input) => {
        const parent = input.closest('.input-container')
        if (parent) {
            const elementMessage = parent.querySelector('.error-message');
            if (elementMessage) {
                elementMessage.textContent = '';
                elementMessage.classList.add('d-none')
            }
        }
        input.classList.remove('is-invalid');
    };

    const isValid = input => {
        let validData = true
        let value = input.value.trim();

        if (input.type === 'checkbox') {
            if (!input.checked && input.required) {
                validData = false
                showErrorMessage(input, 'Ce champ est obligatoire');
            }
        } else if (input.type === 'radio') {
            let radioFamily = document.querySelectorAll(`input[type='radio'][name='${input.name}']`)
            let isChecked = false

            radioFamily.forEach(el => {
                if (el.checked) isChecked = true
            })

            if (!isChecked) {
                validData = false
                showErrorMessage(input, 'Ce champ est obligatoire');
            }
        } else if (input.required && !value && !input.classList.contains('d-none')) {
            validData = false
            showErrorMessage(input, 'Ce champ est obligatoire');
        } else {
            // Vérification des contraintes HTML
            if (value && input.minLength && input.minLength !== -1 && value.length < input.minLength) {
                validData = false;
                showErrorMessage(input, `Minimum ${input.minLength} caractères requis.`);
            }

            if (value && input.maxLength && input.maxLength !== -1 && value.length > input.maxLength) {
                validData = false;
                showErrorMessage(input, `Maximum ${input.maxLength} caractères autorisés.`);
            }

            if (value && input.type === 'number') {
                let numberValue = parseFloat(value);
                if (input.min && numberValue < parseFloat(input.min)) {
                    validData = false;
                    showErrorMessage(input, `La valeur doit être au minimum ${input.min}.`);
                }
                if (input.max && numberValue > parseFloat(input.max)) {
                    validData = false;
                    showErrorMessage(input, `La valeur doit être au maximum ${input.max}.`);
                }
            }

            if (value && input.pattern) {
                let regex = new RegExp(input.pattern);
                if (!regex.test(value)) {
                    validData = false;
                    showErrorMessage(input, `Le format est invalide.`);
                }
            }
        }

        if (validData) clearErrorMessage(input)
        return validData
    }

    // submit le form
    const handleSubmit = (e, inputList) => {
        let hasError = false;

        inputList.forEach(input => {
            if (!isValid(input)) {
                hasError = true;
            }
        });

        if (hasError) e.preventDefault();
    };

    const handleKeyup = (input) => {
        const events = ['keyup', 'change'];

        events.forEach((event) => {
            input.addEventListener(event, () => {
                const isCheckbox = input.type === 'checkbox';
                const hasError = isCheckbox ? !input.checked : !isValid(input);

                if (!hasError) clearErrorMessage(input);
            });
        });
    };

    inputRequired.forEach((input) => {
        handleKeyup(input)
    });

    if (btnSubmit) {
        btnSubmit.forEach((btn) => {
            const input = btn.closest('form').querySelectorAll('input, textarea, select');
            btn.addEventListener('click', (e) => handleSubmit(e, input));
        })
    }

};

const setupFormBehavior = (config) => {
    const {
        elementsToShow = [],
        textInputSelector,
        excludedIds = [],
        symbolsWithoutNumber = ['>=', '>', '<=', '<']
    } = config;

    // Fonction pour afficher les éléments spécifiés
    const showElements = (elementIds) => {
        elementIds.forEach((id) => {
            const element = document.getElementById(id);
            if (element) element.style.display = 'block';
        });
    };

    // Fonction de validation des champs texte
    const validateInputValue = (input, invalidCharacters) => {
        const lastCharacter = input.value.slice(-1);
        if (isNaN(Number(lastCharacter))) {
            if (!(
                (lastCharacter === input.value[0] && invalidCharacters.includes(lastCharacter)) ||
                (lastCharacter === input.value[1] && lastCharacter === '=')
            )) {
                input.value = input.value.slice(0, -1);
            }
        }
    };

    // Configuration des événements pour les champs texte
    const setupInputValidation = (input) => {
        input.addEventListener('keyup', () => validateInputValue(input, ['<', '>']));
        input.addEventListener('focus', () => {
            if (input.value === '') input.value = '>=';
        });
        input.addEventListener('focusout', () => {
            if (input.value !== '') {
                input.value = !isNaN(Number(input.value)) ? '>=' + input.value : input.value;
                if (symbolsWithoutNumber.includes(input.value)) input.value = '';
            }
        });
    };

    // Afficher les éléments requis
    showElements(elementsToShow);

    // Configurer les champs texte
    const textInputs = document.querySelectorAll(textInputSelector);
    textInputs.forEach((input) => {
        if (!excludedIds.includes(input.getAttribute('id'))) {
            setupInputValidation(input);
        }
    });
};

const completeDate = () => {
    const inputDateMontee = document.getElementById('montee_en_charge_date')
    const inputNatureCompte = document.getElementById('montee_en_charge_nature_compte')

    inputNatureCompte.addEventListener('change', () => {
        let dateNature = document.getElementById(inputNatureCompte.value)

        if (dateNature) {
            let date = dateNature.textContent.split('/')
            inputDateMontee.value = `${date[2]}-${date[1]}-${date[0]}`
        } else {
            inputDateMontee.value = ''
        }
    })
}

const addTypeButtonDelete = () => {
    // data-bs-toggle="modal"
    const buttonsDelete = document.querySelectorAll("form button[data-bs-toggle='modal']")

    if(!buttonsDelete) return;

    buttonsDelete.forEach((btn) => {
        btn.setAttribute('type', 'button')
    })

}

const toggleNoteTypeMasse = () => {
    const typeMasseField = document.getElementById('libelle_notification_typeMasse')
    const noteTypeMasse = document.getElementById('note-type-masse')

    if (!typeMasseField || !noteTypeMasse) return

    const value = typeMasseField.value
    noteTypeMasse.style.display = value === "1" ? 'flex' : 'none'

    typeMasseField.addEventListener('change', () => {
        const newValue = typeMasseField.value
        noteTypeMasse.style.display = newValue === "1" ? 'flex' : 'none'
    })
}

document.addEventListener('DOMContentLoaded', () => {
    checkInputRequired()
    addTypeButtonDelete()
    toggleNoteTypeMasse()
})

