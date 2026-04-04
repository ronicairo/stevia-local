document.addEventListener('DOMContentLoaded', () => {

    // cacher les inputs
    const hideIp = () => {
        const inputs = document.querySelectorAll('input[data-hidden],select[data-hidden]');

        const typeParam = document.getElementById('parametrage_wf_idTypeParamWF');
        // Récupérer l'option sélectionnée
        const selectedOption = typeParam.options[typeParam.selectedIndex];
        // Récupérer l'attribut data-name
        const dataName = selectedOption.getAttribute('data-name');

        inputs.forEach(input => {
            const nameInput = input.getAttribute('name');
            const parent = input.closest('.form-row')

            // on cache les inputs tout en s'assurant qu'on ne cache pas celui qui est sélectionné
            if (nameInput !== `parametrage_wf[${dataName}]`) {
                input.removeAttribute('required')
                if (parent) {
                    parent.classList.add('d-none')
                    input.classList.add('d-none')
                }
            }
        })
    }

    // afficher les inputs
    const showInput = () => {
        const typesParam = document.querySelectorAll('#parametrage_wf_idTypeParamWF option')

        typesParam.forEach((type) => {
            const typeAction = document.getElementById('typeaction').value;
            const nameInput = type.getAttribute('data-name');

            if (typeAction === 'courrierauto' && nameInput === 'echeance') type.classList.add('d-none');

            type.addEventListener('click', () => {
                const nameInput = type.getAttribute('data-name');
                const input = document.querySelector(`input[name="parametrage_wf[${nameInput}]"], select[name="parametrage_wf[${nameInput}]"]`)
                const parent = input.closest('.form-row')

                input.setAttribute('required', 'required')
                hideIp()
                parent.classList.remove('d-none')
                input.classList.remove('d-none')
            })
        })
    }

    showInput()
    hideIp()
})